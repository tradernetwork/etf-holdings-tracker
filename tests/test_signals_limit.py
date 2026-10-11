"""`limit` on /signals and /briefing: the same ranking, cut longer; defaults unchanged."""
import csv
import json

import pytest
from fastapi.testclient import TestClient
from api import data

FIELDS = ['ETF Ticker', 'Ticker', 'Name', 'Weight', 'Share Quantity', 'Market Value', 'Sector', 'Option_Type',
          'Refreshed', 'Source_Date', 'Date']
N_BUY, N_SELL = 30, 24


def _rows(fund, day, weights):
    return [{'ETF Ticker': fund, 'Ticker': t, 'Name': t, 'Weight': w, 'Share Quantity': w * 1000,
             'Market Value': w * 1e6, 'Sector': 'X', 'Refreshed': 'True', 'Source_Date': day, 'Date': day}
            for t, w in weights.items()]


@pytest.fixture
def big(tmp_path, monkeypatch):
    """Two days; AVUV buys 30 names and sells 24 (distinct sizes), ARKK adds a few of the same names."""
    buys = {f'B{i:02d}': 1.0 + (i + 1) * 0.2 for i in range(N_BUY)}
    sells = {f'S{i:02d}': 1.0 + i * 0.2 for i in range(N_SELL)}
    prev = {**{t: 1.0 for t in buys}, **{t: w + 1.0 + 0.5 for t, w in sells.items()}}
    curr = {**buys, **sells}
    # keep every fund's book near 100% on both days so drift renormalisation stays small
    rows = {
        '2026-10-08': _rows('AVUV', '2026-10-08', prev) + _rows('ARKK', '2026-10-08', {'B29': 1.0, 'B28': 1.0}),
        '2026-10-09': _rows('AVUV', '2026-10-09', curr) + _rows('ARKK', '2026-10-09', {'B29': 3.0, 'B28': 2.5}),
    }
    for day, r in rows.items():
        with (tmp_path / f'holdings_{day}.csv').open('w', newline='') as f:
            w = csv.DictWriter(f, fieldnames=FIELDS, restval=''); w.writeheader(); w.writerows(r)
    monkeypatch.setattr(data, 'HISTORY_DIR', str(tmp_path))
    data._available_dates.cache_clear()
    data.clear_result_memo()
    yield
    data.clear_result_memo()


@pytest.fixture
def client(monkeypatch):
    from api.server import app, limiter
    monkeypatch.setattr(limiter, 'enabled', False)
    return TestClient(app)


def _j(v):
    return json.dumps(v)


def test_default_responses_are_unchanged_and_carry_no_limit_field(big, client):
    r = client.get('/api/v1/signals').json()
    assert 'limit' not in r
    assert len(r['signals']['buying']) == 10 and len(r['signals']['selling']) == 10
    b = r['briefing']
    assert (len(b['topBuys']), len(b['topSells'])) == (3, 3)
    assert 'limit' not in client.get('/api/v1/briefing').json()
    # the public default is exactly the legacy memoized path
    assert _j(client.get('/api/v1/signals').json()) == _j(data.get_full_payload.__wrapped__(category=None))
    assert _j(client.get('/api/v1/briefing').json()) == _j(data.get_briefing.__wrapped__(category=None))


def test_limit_extends_the_same_order(big, client):
    base = client.get('/api/v1/signals').json()
    for lim in (1, 10, 25, 200):
        r = client.get('/api/v1/signals', params={'limit': lim}).json()
        assert r['limit'] == lim
        for side, n in (('buying', N_BUY), ('selling', N_SELL)):
            got = [s['ticker'] for s in r['signals'][side]]
            assert len(got) == min(lim, n)
            assert got[:10] == [s['ticker'] for s in base['signals'][side]][:min(lim, 10)]
    full = client.get('/api/v1/signals', params={'limit': 200}).json()
    assert len(full['signals']['buying']) == N_BUY and len(full['signals']['selling']) == N_SELL
    scores = [s['convictionScore'] for s in full['signals']['buying']]
    assert scores == sorted(scores, reverse=True)
    # limit=10 equals the default signals exactly (only the echo differs)
    ten = client.get('/api/v1/signals', params={'limit': 10}).json()
    assert _j(ten['signals']) == _j(base['signals'])
    # everything else is identical too; the briefing lists are cut to `limit` (10), not the default 3 / 3 / 5
    assert _j({k: v for k, v in ten.items() if k not in ('limit', 'briefing')}) == _j({k: v for k, v in base.items() if k != 'briefing'})


def test_limit_extends_the_briefing_lists(big, client):
    base = client.get('/api/v1/briefing').json()
    for lim in (2, 3, 50, 200):
        b = client.get('/api/v1/briefing', params={'limit': lim}).json()
        assert b['limit'] == lim
        assert [s['ticker'] for s in b['topBuys']][:3] == [s['ticker'] for s in base['topBuys']][:min(lim, 3)]
        assert len(b['topBuys']) == min(lim, N_BUY)
        assert [x['ticker'] for x in b['crossFundConvergence']][:5] == [x['ticker'] for x in base['crossFundConvergence']][:min(lim, 5)]
        assert len(b['crossFundConvergence']) <= lim
    full = client.get('/api/v1/briefing', params={'limit': 200}).json()
    assert len(full['topBuys']) == N_BUY and len(full['topSells']) == N_SELL
    # the signals embedded in /signals?limit agree with /briefing?limit
    both = client.get('/api/v1/signals', params={'limit': 200}).json()['briefing']
    assert _j(both['topBuys']) == _j(full['topBuys'])


def test_limit_validation(big, client):
    for bad in (0, -1, 201, 'x'):
        assert client.get('/api/v1/signals', params={'limit': bad}).status_code == 422
        assert client.get('/api/v1/briefing', params={'limit': bad}).status_code == 422
    assert client.get('/api/v1/signals', params={'limit': 200}).status_code == 200


def test_every_limit_is_served_from_one_shared_ranking(big, monkeypatch):
    calls = []
    real = data._signals_from
    monkeypatch.setattr(data, '_signals_from', lambda *a, **k: calls.append(1) or real(*a, **k))
    for lim in (1, 5, 50, 200):
        data.get_full_payload_limited(limit=lim)
        data.get_briefing_limited(limit=lim)
        data.get_signals_limited(limit=lim)
    assert len(calls) == 1                         # one compute for all limits and all three views
    data.get_full_payload_limited(category='active-equity', limit=3)
    assert len(calls) == 2                         # a different category is a different ranking


def test_returned_slices_are_copies(big):
    a = data.get_full_payload_limited(limit=5)
    a['signals']['buying'][0]['ticker'] = 'MUTATED'
    a['briefing']['topBuys'].clear()
    b = data.get_full_payload_limited(limit=5)
    assert b['signals']['buying'][0]['ticker'] != 'MUTATED' and len(b['briefing']['topBuys']) == 5
