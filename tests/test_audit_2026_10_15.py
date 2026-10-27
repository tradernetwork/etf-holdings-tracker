"""Regression tests from the 2026-10-15 Android audit: fund-effectiveness 500,
gzip/cache headers, and the fund-count disagreement."""
import pytest

pytest.importorskip("fastapi")

from fastapi.testclient import TestClient

import effectiveness as e
from api import data
from api.server import app

client = TestClient(app)


def _opt(otype, qty, price, dte):
    return {
        'Option_Type': otype, 'Share Quantity': str(qty),
        'Underlying_Price': str(price), 'DTE': str(dte), 'Moneyness': '-0.05',
        'Option_Strike': '100', 'Underlying_Ticker': 'XYZ',
        'Option_Expiry': '2026-11-20', 'Market Value': '0',
    }


# ─── fund-effectiveness ──────────────────────────────────────────

def test_dte_management_zero_notional_does_not_crash():
    """No usable Underlying_Price -> total notional 0 -> used to ZeroDivisionError."""
    opts = [_opt('Call', -100, 0, 7), _opt('Call', -100, 0, 14)]
    res = e.compute_dte_management(opts, fund='EGGQ')
    assert res['avgDTE'] == 10.5  # equal-weight fallback
    assert res['score'] is not None


def test_dte_management_zero_quantity_does_not_crash():
    opts = [_opt('Call', 0, 100, 7)]
    res = e.compute_dte_management(opts, fund='EGGQ')
    assert res['avgDTE'] is None or res['avgDTE'] == 7.0  # no crash either way


def test_analyze_all_funds_skips_one_bad_fund(monkeypatch):
    real = e.analyze_fund
    bad = sorted(e.OPTION_FUNDS)[0]

    def flaky(fund):
        if fund == bad:
            raise ZeroDivisionError('boom')
        return {'fund': fund, 'compositeScore': 50}

    monkeypatch.setattr(e, 'analyze_fund', flaky)
    results = e.analyze_all_funds()
    assert bad not in [r['fund'] for r in results]
    assert len(results) == len(e.OPTION_FUNDS) - 1
    monkeypatch.setattr(e, 'analyze_fund', real)


def test_fund_effectiveness_endpoint_survives_bad_fund(monkeypatch):
    import api.server as srv
    bad = sorted(e.OPTION_FUNDS)[0]
    real = e.analyze_fund

    def flaky(fund):
        if fund == bad:
            raise ZeroDivisionError('boom')
        return real(fund)

    monkeypatch.setattr(e, 'analyze_fund', flaky)
    monkeypatch.setattr(srv, 'analyze_all_funds', e.analyze_all_funds)
    r = client.get('/api/v1/fund-effectiveness')
    assert r.status_code == 200
    assert bad not in [f['fund'] for f in r.json()['funds']]


def test_fund_effectiveness_live_endpoints_ok():
    assert client.get('/api/v1/fund-effectiveness').status_code == 200
    r = client.get('/api/v1/fund-effectiveness/KYLD')
    assert r.status_code in (200, 404)


# ─── fund counts ─────────────────────────────────────────────────

def test_stats_funds_tracked_matches_funds_list():
    stats = client.get('/api/v1/stats').json()
    funds = client.get('/api/v1/funds').json()['funds']
    assert stats['fundsTracked'] == len(funds)


def test_tracked_funds_excludes_blank_and_excluded(monkeypatch):
    rows = [{'ETF Ticker': 'ARKK'}, {'ETF Ticker': ''}, {'ETF Ticker': 'IBIT'},
            {'ETF Ticker': 'ARKK'}, {'ETF Ticker': 'AVUV'}]
    assert data.tracked_funds(rows) == {'ARKK', 'AVUV'}


# ─── gzip + cache headers ────────────────────────────────────────

def test_signals_is_gzipped_when_large():
    r = client.get('/api/v1/signals', headers={'Accept-Encoding': 'gzip'})
    assert r.status_code == 200
    assert r.headers.get('content-encoding') == 'gzip'
    assert r.headers.get('vary', '').lower().find('accept-encoding') >= 0


@pytest.mark.parametrize('path', [
    '/api/v1/signals', '/api/v1/changes', '/api/v1/funds', '/api/v1/sectors',
    '/api/v1/divergences', '/api/v1/stats', '/api/v1/fund-effectiveness',
])
def test_cache_control_on_static_endpoints(path):
    r = client.get(path)
    assert r.status_code == 200
    assert r.headers.get('cache-control') == 'public, max-age=300'


def test_no_cache_control_on_health_auth():
    assert 'cache-control' not in client.get('/health').headers
    assert 'cache-control' not in client.get('/auth/me').headers


def test_mcp_not_gzipped_or_cached():
    h = {'Accept-Encoding': 'gzip', 'Accept': 'application/json, text/event-stream'}
    with TestClient(app) as c:  # context manager runs the MCP lifespan
        r = c.post('/mcp', headers=h, json={
            'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
            'params': {'protocolVersion': '2025-03-26', 'capabilities': {},
                       'clientInfo': {'name': 't', 'version': '0'}}})
    assert r.status_code == 200
    assert 'TickerTrace' in r.text
    assert 'content-encoding' not in r.headers
    assert 'max-age=300' not in r.headers.get('cache-control', '')


def test_effectiveness_endpoint_is_memoised_per_as_of_date(monkeypatch):
    """analyze_all_funds takes ~30s; the endpoint must compute it once per data date."""
    from api import server

    calls = []
    monkeypatch.setattr(server, "analyze_all_funds", lambda: calls.append(1) or [{"fund": "X"}])
    monkeypatch.setattr(server.data, "get_as_of_date", lambda: "2099-01-01")
    server._EFF_CACHE.update(key=None, value=None)
    assert server._all_effectiveness() == [{"fund": "X"}]
    assert server._all_effectiveness() == [{"fund": "X"}]
    assert len(calls) == 1
    monkeypatch.setattr(server.data, "get_as_of_date", lambda: "2099-01-02")
    server._all_effectiveness()
    assert len(calls) == 2


def test_effectiveness_request_path_serves_stale_instead_of_blocking(monkeypatch):
    """After a data sync the as-of date moves; a request must not eat the ~30-50s
    recompute (the phone times out and the browser says "Failed to fetch")."""
    from api import server

    calls = []
    monkeypatch.setattr(server, "analyze_all_funds", lambda: calls.append(1) or [{"fund": "NEW"}])
    monkeypatch.setattr(server.data, "get_as_of_date", lambda: "2099-01-03")
    server._EFF_CACHE.update(key="2099-01-02", value=[{"fund": "OLD"}])
    assert server._all_effectiveness(allow_stale=True) == [{"fund": "OLD"}]
    assert calls == []
    # The background refresher (blocking path) is what brings it current.
    assert server._all_effectiveness() == [{"fund": "NEW"}]
    assert len(calls) == 1
    # Cold worker with nothing cached still has to compute.
    server._EFF_CACHE.update(key=None, value=None)
    assert server._all_effectiveness(allow_stale=True) == [{"fund": "NEW"}]
