import csv
import json
import os
from pathlib import Path

import pytest

from api import data


@pytest.fixture(autouse=True)
def clear_memo():
    data.clear_result_memo()
    yield
    data.clear_result_memo()


def write_day(path, rows):
    fields = ['ETF Ticker', 'Ticker', 'Name', 'Weight', 'Share Quantity', 'Option_Type', 'Source_Date', 'Refreshed']
    with path.open('w') as f:
        w = csv.DictWriter(f, fields)
        w.writeheader()
        for fund, ticker, weight, refreshed, source in rows:
            w.writerow(dict(zip(fields, [fund, ticker, ticker, weight, 100, '', source, refreshed])))


@pytest.fixture
def monday_history(tmp_path, monkeypatch):
    for day, weight, fresh, source in [('2026-09-25', 1, 'True', '2026-09-25'), ('2026-10-02', 1, 'False', '2026-09-25'), ('2026-10-09', 1, 'False', '2026-09-25'), ('2026-10-12', 3, 'True', '2026-10-12')]:
        write_day(tmp_path / f'holdings_{day}.csv', [('ARKK', 'TER', weight, fresh, source), ('AVUV', 'OTHER', 2, 'True', day)])
    monkeypatch.setattr(data, 'HISTORY_DIR', str(tmp_path))
    monkeypatch.setattr(data, 'get_fund_aum', lambda f: 1.0)
    return tmp_path


def test_monday_catch_up_cannot_be_a_daily_stock_move(monday_history):
    d = data.get_stock_detail('TER')
    assert d['institutional']['daily'] == 0
    assert d['institutional']['weekly'] == 0
    # Monthly starts on the real Sep 25 snapshot: multi-week changes remain valid.
    assert d['institutional']['monthly'] == 1
    assert d['history'][-1]['blendedWeight'] == d['history'][-2]['blendedWeight']
    assert d['institutional']['streak'] is None
    assert d['historyAdjustedForCatchUp'] is True


def test_history_index_is_shared_and_returned_values_are_owned(monday_history, monkeypatch):
    calls = []
    real = data._read_csv
    monkeypatch.setattr(data, '_read_csv', lambda p: (calls.append(p), real(p))[1])
    a = data.get_stock_detail('TER')
    n = len(calls)
    data.get_stock_detail('OTHER')
    assert len(calls) == n
    a['history'][-1]['blendedWeight'] = 999
    assert data.get_stock_detail('TER')['history'][-1]['blendedWeight'] != 999


def test_older_history_correction_invalidates(monday_history):
    a = data.get_stock_detail('OTHER')
    write_day(monday_history / 'holdings_2026-09-25.csv', [('ARKK', 'TER', 1, 'True', '2026-09-25'), ('AVUV', 'OTHER', 4, 'True', '2026-09-25')])
    b = data.get_stock_detail('OTHER')
    assert a['history'] != b['history']


def test_unknown_ticker_and_zero_institutional_exposure(monday_history):
    assert data.get_stock_detail('UNKNOWN') is None
    assert data.get_ticker_detail('UNKNOWN') is None


def test_aum_validation_is_once_per_scope_and_refreshes_between_scopes(monkeypatch):
    calls = []
    monkeypatch.setattr(data, 'get_as_of_date', lambda: (calls.append(1), '2026-10-09')[1])
    monkeypatch.setattr(data, '_fund_aum_map', lambda *args: {'AVUV': float(len(calls)), 'UNKNOWN': None})
    with data.aum_snapshot_scope():
        assert data.get_fund_aum('AVUV') == 1
        for _ in range(1000):
            assert data.get_fund_aum('AVUV') == 1
            assert data.get_fund_aum('UNKNOWN') is None
        with data.aum_snapshot_scope():
            assert data.get_fund_aum('AVUV') == 1
    with data.aum_snapshot_scope():
        assert data.get_fund_aum('AVUV') == 2
    assert len(calls) == 2


def test_new_snapshot_invalidates_stock_index(monday_history):
    before = data.get_stock_detail('OTHER')
    write_day(monday_history / 'holdings_2026-10-13.csv', [('ARKK', 'TER', 3, 'True', '2026-10-13'), ('AVUV', 'OTHER', 4, 'True', '2026-10-13')])
    after = data.get_stock_detail('OTHER')
    assert after['history'][-1]['date'] != before['history'][-1]['date']
    assert after['institutional']['daily'] == 1


def test_signature_covers_thirtieth_session(tmp_path, monkeypatch):
    from datetime import date, timedelta
    dates = []
    d = date(2026, 10, 9)
    while len(dates) < 35:
        if data._is_trading_day(d.isoformat()):
            dates.append(d.isoformat())
        d -= timedelta(days=1)
    for day in dates:
        write_day(tmp_path / f'holdings_{day}.csv', [('AVUV', 'TEST', 1, 'True', day)])
    monkeypatch.setattr(data, 'HISTORY_DIR', str(tmp_path))
    monkeypatch.setattr(data, 'get_fund_aum', lambda f: 1.0)
    before = data.get_stock_detail('TEST')
    write_day(tmp_path / f'holdings_{dates[29]}.csv', [('AVUV', 'TEST', 4, 'True', dates[29])])
    after = data.get_stock_detail('TEST')
    assert before['history'][0]['blendedWeight'] == 1
    assert after['history'][0]['blendedWeight'] == 4
    assert before['history'][1:] == after['history'][1:]


@pytest.mark.parametrize('previous,current,guarded', [('False','True',True), ('False','',True), ('True','True',False), ('','True',False)])
def test_stock_horizons_share_catch_up_semantics(tmp_path, monkeypatch, previous, current, guarded):
    write_day(tmp_path / 'holdings_2026-10-08.csv', [('ARKK', 'TEST', 1, previous, '2026-09-25')])
    write_day(tmp_path / 'holdings_2026-10-09.csv', [('ARKK', 'TEST', 3, current, '2026-10-09')])
    monkeypatch.setattr(data, 'HISTORY_DIR', str(tmp_path))
    monkeypatch.setattr(data, 'get_fund_aum', lambda f: 1.0)
    result = data.get_stock_detail('TEST')
    assert result['institutional']['daily'] == (0 if guarded else 2)
    assert result['history'][-1]['blendedWeight'] - result['history'][-2]['blendedWeight'] == (0 if guarded else 2)


def test_trend_signal_uses_unrounded_flow(tmp_path, monkeypatch):
    for day, weight in [('2026-09-09', .11), ('2026-10-02', .14), ('2026-10-08', .1291008), ('2026-10-09', .1291008)]:
        write_day(tmp_path / f'holdings_{day}.csv', [('AVUV', 'TEST', weight, 'True', day)])
    monkeypatch.setattr(data, 'HISTORY_DIR', str(tmp_path))
    monkeypatch.setattr(data, 'get_fund_aum', lambda f: 1.0)
    result = data.get_stock_detail('TEST')
    assert result['institutional']['daily'] == 0
    assert result['institutional']['signal'] == 'distribution-starting'
    assert 'historyAdjustedForCatchUp' not in result


def test_prewarm_warms_the_same_history_index_requests_use(monday_history):
    """The memo key includes the call's args: prewarming `_stock_history_index()` while requests call
    `_stock_history_index(30)` left the first request rebuilding (~6 s) and two ~75 MiB copies resident."""
    data.clear_result_memo()
    assert data.prewarm_snapshot_caches() is True
    data.get_stock_detail('TER')
    keys = [k for k in data._memo if k[0] == '_stock_history_index']
    assert len(keys) == 1, keys


def test_absent_days_serialize_as_float_zero_like_before(tmp_path, monkeypatch):
    """Byte identity: a ticker that was not held on an earlier day has blendedWeight 0.0 (float), never the int 0."""
    write_day(tmp_path / 'holdings_2026-10-08.csv', [('AVUV', 'OLD', 1, 'True', '2026-10-08')])
    write_day(tmp_path / 'holdings_2026-10-09.csv', [('AVUV', 'OLD', 1, 'True', '2026-10-09'), ('AVUV', 'FRESH', 2, 'True', '2026-10-09')])
    monkeypatch.setattr(data, 'HISTORY_DIR', str(tmp_path))
    monkeypatch.setattr(data, 'get_fund_aum', lambda f: 1.0)
    data._available_dates.cache_clear()
    h = data.get_stock_detail('FRESH')['history']
    assert h[0]['blendedWeight'] == 0 and isinstance(h[0]['blendedWeight'], float)
    assert json.dumps(h[0]).count('0.0') >= 1 and '"blendedWeight": 0,' not in json.dumps(h[0])
    inst = data.get_stock_detail('FRESH')['institutional']
    assert all(isinstance(inst[k], float) for k in ('blendedWeight', 'daily', 'weekly', 'monthly'))
