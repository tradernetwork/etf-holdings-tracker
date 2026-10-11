"""Changes paging is opt-in: complete, stable, guarded and snapshot-consistent."""
import csv
import io
import os
import shutil

import pytest
from fastapi.testclient import TestClient
from api import data
from api.server import app, limiter

@pytest.fixture(autouse=True)
def clean_memo():
    data.clear_result_memo()
    enabled = limiter.enabled
    limiter.enabled = False
    yield
    limiter.enabled = enabled
    data.clear_result_memo()

@pytest.fixture
def client(data_with_fixtures):
    return TestClient(app)

@pytest.fixture
def large_book(monkeypatch):
    rows = [dict(fund='ARKK' if i % 2 else 'AVUV', ticker=f'T{i:05}', name=f'Name {i}',
                 sector='Technology' if i % 3 else 'Energy', type='NEW',
                 fundCategory='active-equity', activeWeightDelta=1 if i % 2 else -1,
                 weightDelta=1, weight=2, prevWeight=1, activeFlowUsd=None)
            for i in range(5501)]
    monkeypatch.setattr(data, 'compute_daily_changes', lambda: list(rows))
    return rows

def test_default_unchanged_and_pages_complete(client, large_book):
    legacy = client.get('/api/v1/changes').json()
    assert set(legacy) == {'asOfDate', 'count', 'changes'}
    assert legacy['changes'] == large_book[:50]
    pages = [client.get('/api/v1/changes', params={'page': p, 'size': 2000}).json() for p in range(1, 4)]
    assert all(p['total'] == 5501 and p['pages'] == 3 for p in pages)
    combined = [r for p in pages for r in p['changes']]
    assert len(combined) == len({(r['fund'], r['ticker'], r['type']) for r in combined}) == 5501
    assert {r['ticker'] for r in combined} == {r['ticker'] for r in large_book}
    assert len({p['snapshot'] for p in pages}) == 1
    assert client.get('/api/v1/changes?page=4&size=2000').json()['changes'] == []
    assert client.get('/api/v1/changes?size=2001').status_code == 422

def test_filters_compose_and_csv_uncapped(client, large_book):
    params = {'page': 1, 'size': 2000, 'provider': 'ARK Invest', 'direction': 'buying',
              'category': 'active-equity', 'sector': 'Technology', 'q': 'Name', 'type': 'NEW'}
    body = client.get('/api/v1/changes', params=params).json()
    expected = [r for r in large_book if r['fund'] == 'ARKK' and r['sector'] == 'Technology']
    assert body['total'] == len(expected)
    assert {r['ticker'] for r in body['changes']} == {r['ticker'] for r in expected}
    exported = client.get('/api/v1/changes?format=csv')
    assert exported.headers['content-type'].startswith('text/csv')
    rows = list(csv.DictReader(io.StringIO(exported.text)))
    assert len(rows) == 5501
    assert rows[0]['activeFlowUsd'] == ''  # unknown dollars stay unknown

def test_memo_hits_and_new_snapshot_invalidates(tmp_path, fixture_dir, monkeypatch):
    for p in os.listdir(fixture_dir):
        if p.startswith('holdings_') and p.endswith('.csv'):
            shutil.copy(os.path.join(fixture_dir, p), tmp_path / p)
    monkeypatch.setattr(data, 'HISTORY_DIR', str(tmp_path))
    calls = []
    real = data.compute_daily_changes
    monkeypatch.setattr(data, 'compute_daily_changes', lambda: (calls.append(1), real())[1])
    a = data.query_changes(period='daily')
    b = data.query_changes(period='daily')
    assert a == b and len(calls) == 1
    shutil.copy(tmp_path / 'holdings_2026-05-18.csv', tmp_path / 'holdings_2026-05-19.csv')
    c = data.query_changes(period='daily')
    assert len(calls) == 2 and c['snapshot'] != a['snapshot']
    client = TestClient(app)
    assert client.get('/api/v1/changes', params={'page': 2, 'snapshot': a['snapshot']}).status_code == 409

@pytest.mark.parametrize('period,days', [('weekly', 7), ('monthly', 30)])
def test_signature_reaches_sparse_lookback_file(tmp_path, fixture_dir, monkeypatch, period, days):
    source = os.path.join(fixture_dir, 'holdings_2026-05-18.csv')
    for name in ('2026-05-18', '2026-05-15', '2026-03-02'):
        shutil.copy(source, tmp_path / f'holdings_{name}.csv')
    monkeypatch.setattr(data, 'HISTORY_DIR', str(tmp_path))
    a = data.query_changes(period=period)
    old = tmp_path / 'holdings_2026-03-02.csv'
    old.write_text(old.read_text().replace('0.5', '0.6'))
    os.utime(old, ns=(old.stat().st_atime_ns, old.stat().st_mtime_ns + 10000000))
    b = data.query_changes(period=period)
    assert a['snapshot'] != b['snapshot']

def test_real_guarded_rows_and_stable_ties(client, data_with_fixtures):
    full = data_with_fixtures.compute_daily_changes()
    response = client.get('/api/v1/changes?page=1&size=2000').json()
    assert sorted(response['changes'], key=lambda r: (r['fund'], r['ticker'], r['type'])) == sorted(full, key=lambda r: (r['fund'], r['ticker'], r['type']))


def test_same_day_rewrite_and_deep_monthly_file_invalidate(tmp_path, fixture_dir, monkeypatch):
    from datetime import date, timedelta
    source = os.path.join(fixture_dir, 'holdings_2026-05-18.csv')
    day = date(2026, 5, 18)
    names = []
    for offset in range(45):
        d = day - timedelta(days=offset)
        if d.weekday() < 5:
            shutil.copy(source, tmp_path / f'holdings_{d}.csv')
            names.append(str(d))
    monkeypatch.setattr(data, 'HISTORY_DIR', str(tmp_path))
    assert data._changes_signature_depth('monthly') > 12
    daily = data.query_changes(period='daily')['snapshot']
    monthly = data.query_changes(period='monthly')['snapshot']
    old_name = data.get_available_dates()[data._changes_signature_depth('monthly') - 1]
    old = tmp_path / f'holdings_{old_name}.csv'
    os.utime(old, ns=(old.stat().st_atime_ns, old.stat().st_mtime_ns + 10000000))
    assert data.query_changes(period='monthly')['snapshot'] != monthly
    assert data.query_changes(period='daily')['snapshot'] == daily
    latest = tmp_path / 'holdings_2026-05-18.csv'
    os.utime(latest, ns=(latest.stat().st_atime_ns, latest.stat().st_mtime_ns + 10000000))
    assert data.query_changes(period='daily')['snapshot'] != daily


def test_paging_keeps_catchup_and_stale_guards(tmp_path, monkeypatch):
    fields = ['ETF Ticker', 'Ticker', 'Name', 'Weight', 'Share Quantity', 'Market Value',
              'Sector', 'Refreshed', 'Source_Date', 'Date']
    for day, ark_weight, ark_fresh in [('2026-10-09', 10, False), ('2026-10-12', 4, True)]:
        rows = []
        for fund, ticker, weight, fresh in [('ARKK', 'TSLA', ark_weight, ark_fresh),
                                          ('AVUV', 'AAA', 2 if day.endswith('09') else 3, True),
                                          ('ARKQ', 'COIN', 6, False)]:
            rows.append({'ETF Ticker':fund,'Ticker':ticker,'Name':ticker,'Weight':weight,
                         'Share Quantity':weight*1000,'Market Value':weight*1e6,'Sector':'Technology',
                         'Refreshed':str(fresh),'Source_Date':day if fresh else '2026-09-25',
                         'Date':day if fresh else '2026-09-25'})
        with (tmp_path / f'holdings_{day}.csv').open('w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=fields);writer.writeheader();writer.writerows(rows)
    monkeypatch.setattr(data, 'HISTORY_DIR', str(tmp_path))
    body = TestClient(app).get('/api/v1/changes?page=1&size=2000').json()
    assert {r['fund'] for r in body['changes']} == {'AVUV'}
    assert data.get_catch_up_funds() == {'ARKK':'2026-09-25'}
    assert body['changes'] == data.compute_daily_changes()


def test_schema_documents_paging_and_export(client):
    operation = client.get('/openapi.json').json()['paths']['/api/v1/changes']['get']
    assert {'page','size','snapshot','sector','q','type','format'} <= {p['name'] for p in operation['parameters']}
    assert 'text/csv' in operation['responses']['200']['content']
    assert {'total','page','size','pages','snapshot'} <= set(operation['responses']['200']['content']['application/json']['schema']['properties'])


def test_sync_during_compute_retries_and_repeated_syncs_fail(data_with_fixtures, monkeypatch):
    state = {'version': 0, 'calls': 0}
    monkeypatch.setattr(data, 'snapshot_signature', lambda depth=12: ('snapshot', state['version']))
    def moves():
        state['calls'] += 1
        if state['calls'] == 1:
            state['version'] += 1
        return []
    monkeypatch.setattr(data, 'compute_daily_changes', moves)
    assert data.query_changes()['changes'] == []
    assert state['calls'] == 2
    data.clear_result_memo()
    def always_changes():
        state['version'] += 1
        return []
    monkeypatch.setattr(data, 'compute_daily_changes', always_changes)
    assert TestClient(app).get('/api/v1/changes?page=1').status_code == 503
