"""Additive mobile data: units, estimates, category isolation and cached history."""
import csv
import pytest
from api import data, income


def row(fund='BLOX', ticker='THRM', weight='2', **extra):
    return {'ETF Ticker': fund, 'Ticker': ticker, 'Name': ticker,
            'Weight': weight, 'Share Quantity': '100', 'Market Value': '2000000',
            'Sector': '', 'Option_Type': '', 'NetAssets': '284698830', **extra}


@pytest.fixture
def snapshot(monkeypatch):
    rows = [row()]
    monkeypatch.setattr(data, 'get_latest_holdings', lambda: rows)
    monkeypatch.setattr(income, 'get_latest_holdings', lambda: rows)
    monkeypatch.setattr(data, 'get_previous_holdings', lambda: [])
    monkeypatch.setattr(data, 'get_as_of_date', lambda: '2026-10-09')
    monkeypatch.setattr(data, '_compute_streaks', lambda: {})
    data._fund_aum_map.cache_clear()
    yield rows
    data._fund_aum_map.cache_clear()


def test_units_agree_across_fund_income_and_ticker(snapshot):
    records = [data.get_funds_index()[0], data.get_fund_detail('BLOX'),
               income.get_income_fund('BLOX'), income.get_income_overview()['funds'][0],
               data.get_ticker_detail('THRM')['holdings'][0]]
    for r in records:
        assert r['aum'] == pytest.approx(0.28469883)
        assert r['aumUsd'] == 284698830
    assert data.get_all_holdings()['holdings'][0]['positionUsd'] == 5693977
    assert data.get_fund_detail('BLOX')['topHoldings'][0]['positionUsd'] == 5693977


def test_change_signed_estimates_and_unknown_aum(monkeypatch):
    monkeypatch.setattr(data, 'get_fund_aum', lambda fund: 2 if fund == 'ARKK' else 0)
    changes = data._changes_between([], [row('ARKK', weight='5'), row('NOAUM', weight='5')])
    known = next(c for c in changes if c['fund'] == 'ARKK')
    assert known['positionUsd'] == 0
    assert known['activeFlowUsd'] == -100000000
    unknown = next(c for c in changes if c['fund'] == 'NOAUM')
    assert unknown['positionUsd'] is None
    assert unknown['activeFlowUsd'] is None
    assert data.get_fund_aum_usd('NOAUM') is None


def test_sector_only_uses_curated_fallback(tmp_path):
    path = tmp_path / 'holdings.csv'
    rows = [row('ARKK'), row('AVUV', Sector='CONSUMER DISCRETIONARY'),
            row('ARKK', 'AAPL'), row('ARKK', 'MYSTERY'),
            row('ARKK', 'CONFLICT'), row('AVUV', 'CONFLICT', Sector='ENERGY'),
            row('AVLV', 'CONFLICT', Sector='MATERIALS')]
    with path.open('w') as f:
        w = csv.DictWriter(f, fieldnames=rows[0].keys()); w.writeheader(); w.writerows(rows)
    parsed = data._read_csv(str(path))
    assert next(r for r in parsed if r['ETF Ticker']=='ARKK' and r['Ticker']=='THRM')['Sector'] == ''
    assert next(r for r in parsed if r['Ticker']=='AAPL')['Sector'] == 'Information Technology'
    assert next(r for r in parsed if r['Ticker']=='MYSTERY')['Sector'] == ''
    assert next(r for r in parsed if r['ETF Ticker']=='ARKK' and r['Ticker']=='CONFLICT')['Sector'] == ''


def test_briefing_filters_before_scoring_and_streaks(monkeypatch):
    monkeypatch.setattr(data, 'get_fund_aum', lambda _: 1)
    changes = data._changes_between([row('ARKK', weight='3'), row('IDVO', weight='4')], [])
    monkeypatch.setattr(data, 'compute_daily_changes_with_options', lambda: changes)
    monkeypatch.setattr(data, '_compute_streaks', lambda: {('ARKK','THRM'):3, ('IDVO','THRM'):5})
    assert set(data.get_briefing()['topBuys'][0]['funds']) == {'ARKK','IDVO'}
    equity = data.get_briefing(category='active-equity')
    assert equity['topBuys'][0]['funds'] == ['ARKK']
    assert equity['topBuys'][0]['totalWeightDelta'] == 3
    assert all(s['fund']=='ARKK' for s in equity['activeStreaks'])


def test_layering_dollar_totals(tmp_path, monkeypatch):
    monkeypatch.setattr(data, 'HISTORY_DIR', str(tmp_path))
    for date, rows in [('2026-10-07',[row('ARKK','BASE')]),
                       ('2026-10-08',[row('ARKK',weight='1'),row('AVUV',weight='2')])]:
        with (tmp_path/f'holdings_{date}.csv').open('w') as f:
            w=csv.DictWriter(f,fieldnames=rows[0].keys());w.writeheader();w.writerows(rows)
    monkeypatch.setattr(data, 'get_fund_aum', lambda _: 2)
    p=data.compute_layering_patterns(min_funds=2)['patterns'][0]
    assert p['consensusAumUsd']==4000000000
    assert p['positionUsdTotal']==60000000
    assert [e['positionUsd'] for e in p['entrySequence']]==[20000000,40000000]
    assert all(e['aumUsd']==2000000000 for e in p['entrySequence'])
    monkeypatch.setattr(data, 'get_fund_aum', lambda fund: 2 if fund == 'ARKK' else None)
    p=data.compute_layering_patterns(min_funds=2)['patterns'][0]
    assert p['consensusAum'] is None
    assert p['consensusAumUsd'] is None
    assert p['positionUsdTotal'] is None


def test_openapi_units_estimates_and_briefing_category():
    from fastapi.testclient import TestClient
    from api.server import app
    spec=TestClient(app).get('/openapi.json').json()
    props=spec['components']['schemas']['DollarFields']['properties']
    assert 'billions' in props['aum']['description']
    assert 'estimate' in props['positionUsd']['description'].lower()
    assert 'estimate' in props['activeFlowUsd']['description'].lower()
    briefing=spec['paths']['/api/v1/briefing']['get']
    assert any(p['name']=='category' for p in briefing['parameters'])


def test_positive_and_short_position_estimates(monkeypatch):
    monkeypatch.setattr(data, 'get_fund_aum', lambda _: 2)
    changes = data._changes_between([row('ARKK', weight='5')], [])
    assert changes[0]['positionUsd'] == 100000000
    assert changes[0]['activeFlowUsd'] == 100000000
    assert data.estimate_position_usd('ARKK', -5) == -100000000
    assert data._sum_known([100, None]) is None


def test_same_day_aum_correction_invalidates_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(data, 'HISTORY_DIR', str(tmp_path))
    path = tmp_path / 'holdings_2026-10-09.csv'
    def write(nav):
        r = row(NetAssets=str(nav))
        with path.open('w') as f:
            writer = csv.DictWriter(f, fieldnames=r.keys())
            writer.writeheader()
            writer.writerow(r)
    data._fund_aum_map.cache_clear()
    write(100000000)
    assert data.get_fund_aum_usd('BLOX') == 100000000
    write(3000000000)
    assert data.get_fund_aum_usd('BLOX') == 3000000000
    data._fund_aum_map.cache_clear()


def test_briefing_http_category_validation_and_forwarding(monkeypatch):
    from fastapi.testclient import TestClient
    from api.server import app, limiter
    monkeypatch.setattr(limiter, 'enabled', False)
    monkeypatch.setattr(data, 'get_briefing', lambda *, category=None: {'category': category})
    client = TestClient(app)
    assert client.get('/api/v1/briefing').json()['category'] is None
    assert client.get('/api/v1/briefing?category=active-equity').json()['category'] == 'active-equity'
    assert client.get('/api/v1/briefing?category=option-income').json()['category'] == 'option-income'
    assert client.get('/api/v1/briefing?category=bogus').status_code == 422


@pytest.mark.parametrize('fund,ticker,name,donor,sector', [
    ('XA','S','SentinelOne','Singha Estate','REAL ESTATE'),
    ('KYC','EFX','Equifax','Enerflex','ENERGY'),
    ('KYC','RKT','Rocket','Reckitt','CONSUMER STAPLES'),
    ('ULTI','CASH','Cash','Pathward','FINANCIALS'),
])
def test_sector_foreign_donor_never_labels_blank(tmp_path, fund, ticker, name, donor, sector):
    path=tmp_path/'collision.csv'
    rows=[row(fund,ticker,Name=name),row('AVDE',ticker,Name=donor,Sector=sector)]
    with path.open('w') as f:
        writer=csv.DictWriter(f,fieldnames=rows[0].keys());writer.writeheader();writer.writerows(rows)
    assert data._read_csv(str(path))[0]['Sector']==''


def test_unknown_aum_is_null_across_endpoints(snapshot, monkeypatch):
    snapshot[0].update({'ETF Ticker':'UNKNOWN','NetAssets':'','Market Value':''})
    monkeypatch.setattr(income,'get_fund_category',lambda _: 'option-income')
    data._fund_aum_map.cache_clear()
    assert data.get_fund_aum('UNKNOWN') is None
    records=[data.get_funds_index()[0],data.get_fund_detail('UNKNOWN'),
             data.get_ticker_detail('THRM')['holdings'][0],
             income.get_income_fund('UNKNOWN')]
    for record in records:
        assert record['aum'] is None
        assert record['aumUsd'] is None
    assert data.get_all_holdings()['holdings'][0]['positionUsd'] is None


def test_changes_resolve_aum_once_per_fund(monkeypatch):
    calls=[]
    def aum(fund):
        calls.append(fund)
        return 1
    monkeypatch.setattr(data,'get_fund_aum',aum)
    data._changes_between([row('ARKK','AAPL'),row('ARKK','MSFT'),row('AVUV','TSLA')],[])
    assert sorted(calls)==['ARKK','AVUV']


def test_signals_resolve_aum_once_per_fund(monkeypatch):
    calls = []
    def aum(fund):
        calls.append(fund)
        return 1
    monkeypatch.setattr(data, 'get_fund_aum', aum)
    changes = data._changes_between([row('ARKK','AAPL'), row('ARKK','MSFT')], [])
    calls.clear()
    data._signals_from(changes, streaks={})
    assert calls == ['ARKK']
