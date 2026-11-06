"""Intraday trade blotter: parsing, lossless dedupe, FIFO replay, API + MCP."""

import os

import pytest

from api import trades as T


def row(date='08/29/2025', fund='ULTY', ticker='AFRM', typ='B', qty='100', px='50'):
    return {'Date': date, 'Fund': fund, 'Ticker': ticker, 'Type': typ,
            'Qty/Par Value': qty, 'Exec Price': px}


def tr(date, fund, ticker, side, qty, price):
    return {'date': date, 'fund': fund, 'ticker': ticker, 'side': side, 'qty': qty, 'price': price}


# ── parsing ──

def test_to_number_strips_every_comma():
    assert T.to_number('1,234,567.5') == 1234567.5   # first-comma-only bug gives 1234
    assert T.to_number('$12.30') == 12.30
    assert T.to_number('(500)') == -500
    assert T.to_number('') is None and T.to_number('abc') is None


def test_parse_occ_and_exchange_prefixed_root():
    o = T.parse_occ('AFRM  250829C00083000')
    assert o == {'underlying': 'AFRM', 'optionType': 'CALL', 'strike': 83.0, 'expiry': '2025-08-29'}
    assert T.parse_occ('2MU   260918C00950000')['underlying'] == 'MU'
    assert T.parse_occ('AAPL') is None
    assert T.parse_occ('AFRM  251345C00083000') is None   # month 13


def test_ticker_spacing_collapses_to_one_spelling():
    a, _ = T.parse_trades([row(ticker='AFRM  250829C00083000')])
    b, _ = T.parse_trades([row(ticker='AFRM250829C00083000')])
    assert a[0]['ticker'] == b[0]['ticker'] == 'AFRM250829C00083000'


def test_rejects_are_counted_not_silent():
    rows = [row(), row(typ='XX'), row(qty='0'), row(date='nope'), row(fund=''), row(px='')]
    trades, rej = T.parse_trades(rows)
    assert len(trades) == 1
    assert rej == {'unknown_side:XX': 1, 'bad_qty': 1, 'bad_date': 1,
                   'missing_fund_or_ticker': 1, 'bad_price': 1}


def test_option_notional_uses_100_multiplier():
    t = T.enrich(tr('2025-08-29', 'ULTY', 'AFRM250829C00083000', 'SS', 10, 1.5))
    assert t['instrument'] == 'option' and t['notional'] == 1500.0
    assert T.enrich(tr('2025-08-29', 'ULTY', 'AFRM', 'B', 10, 50))['notional'] == 500.0


# ── dedupe ──

def test_merge_is_idempotent():
    snap = [tr('2025-08-29', 'ULTY', 'AFRM', 'B', 100, 50)]
    once = T.merge_trades([], snap)
    assert T.merge_trades(once, snap) == once


def test_merge_keeps_genuine_identical_fills():
    two = [tr('2025-08-29', 'ULTY', 'AFRM', 'B', 100, 50)] * 2
    once = T.merge_trades([], two)
    assert len(once) == 2                       # a plain unique key would keep 1
    assert len(T.merge_trades(once, two)) == 2  # ...and re-ingest still adds nothing
    three = two + [two[0]]
    assert len(T.merge_trades(once, three)) == 3


def test_same_trade_in_two_funds_is_two_trades():
    snap = [tr('2025-08-29', 'ULTY', 'AFRM', 'B', 100, 50), tr('2025-08-29', 'SLTY', 'AFRM', 'B', 100, 50)]
    assert len(T.merge_trades([], snap)) == 2


def test_write_trades_roundtrip_and_reingest(tmp_path):
    d = str(tmp_path)
    snap = [tr('2025-08-29', 'ULTY', 'AFRM', 'B', 1234567, 50.25), tr('2025-08-28', 'ULTY', 'AFRM', 'S', 5, 51)]
    assert T.write_trades(snap, d) == {'2025-08-28': 1, '2025-08-29': 1}
    assert T.write_trades(snap, d) == {'2025-08-28': 0, '2025-08-29': 0}
    assert sorted(os.listdir(d)) == ['trades_2025-08-28.csv', 'trades_2025-08-29.csv']
    back = T.read_day(os.path.join(d, 'trades_2025-08-29.csv'))
    assert back[0]['qty'] == 1234567 and back[0]['price'] == 50.25


# ── FIFO ──

def test_fifo_long_partial_close_across_lots():
    f = T.replay_fifo([
        tr('2025-01-02', 'ULTY', 'AFRM', 'B', 100, 10),
        tr('2025-01-03', 'ULTY', 'AFRM', 'B', 100, 20),
        tr('2025-01-06', 'ULTY', 'AFRM', 'S', 150, 30),
    ])
    r = f['realized']
    assert [(x['qty'], x['pnl']) for x in r] == [(100, 2000.0), (50, 500.0)]   # oldest lot first
    assert f['openLots'] == [{'fund': 'ULTY', 'ticker': 'AFRM', 'direction': 'long',
                              'qty': 50, 'openDate': '2025-01-03', 'openPrice': 20}]


def test_fifo_short_option_pnl_has_multiplier():
    c = 'AFRM250829C00083000'
    f = T.replay_fifo([tr('2025-08-25', 'ULTY', c, 'SS', 10, 2.00),
                       tr('2025-08-27', 'ULTY', c, 'BC', 10, 0.50)])
    assert f['realized'][0]['pnl'] == 1500.0           # (2.00-0.50) * 10 * 100
    assert f['realized'][0]['direction'] == 'short'


def test_same_day_open_and_close_match_regardless_of_file_order():
    c = 'AFRM250829C00083000'
    f = T.replay_fifo([tr('2025-08-29', 'ULTY', c, 'BC', 5, 0.10),    # listed first
                       tr('2025-08-29', 'ULTY', c, 'SS', 5, 1.00)])   # 0DTE round trip
    assert f['unmatchedClosingQty'] == {} and f['realized'][0]['pnl'] == 450.0


def test_funds_never_net_against_each_other():
    f = T.replay_fifo([tr('2025-01-02', 'ULTY', 'AFRM', 'B', 100, 10),
                       tr('2025-01-03', 'SLTY', 'AFRM', 'S', 100, 30)])
    assert f['realized'] == []
    assert f['unmatchedClosingQty'] == {'SLTY:AFRM': 100}


def test_close_without_opening_lot_is_counted_not_invented():
    f = T.replay_fifo([tr('2025-01-03', 'ULTY', 'AFRM', 'S', 40, 30)])
    assert f['realized'] == [] and f['unmatchedClosingQty'] == {'ULTY:AFRM': 40}


def test_expired_short_option_realizes_full_premium():
    c = 'AFRM250829C00083000'
    f = T.replay_fifo([tr('2025-08-25', 'ULTY', c, 'SS', 10, 2.00),
                       tr('2025-09-05', 'ULTY', 'AFRM', 'B', 1, 1)], as_of='2025-09-05')
    exp = [r for r in f['realized'] if r['closeReason'] == 'expired']
    assert exp and exp[0]['pnl'] == 2000.0 and exp[0]['closeDate'] == '2025-08-29'
    assert not [l for l in f['openLots'] if l['ticker'] == c]


def test_unexpired_option_stays_open():
    c = 'AFRM250926C00083000'
    f = T.replay_fifo([tr('2025-08-25', 'ULTY', c, 'SS', 10, 2.00)], as_of='2025-08-26')
    assert f['realized'] == [] and len(f['openLots']) == 1


# ── API surface ──

@pytest.fixture
def populated(tmp_path, monkeypatch):
    c = 'AFRM250829C00083000'
    T.write_trades([
        tr('2025-08-25', 'ULTY', c, 'SS', 10, 2.00),
        tr('2025-08-27', 'ULTY', c, 'BC', 10, 0.50),
        tr('2025-08-27', 'ULTY', 'AFRM', 'B', 100, 50),
        tr('2025-08-28', 'SLTY', 'APP', 'B', 10, 300),
    ], str(tmp_path))
    monkeypatch.setattr(T, 'TRADES_DIR', str(tmp_path))
    T._cache.clear()
    return str(tmp_path)


def test_get_trades_empty_dir_is_a_valid_response(tmp_path):
    r = T.get_trades(trades_dir=str(tmp_path))
    assert r['count'] == 0 and r['asOfDate'] is None and r['trades'] == []


def test_get_trades_filters_summary_and_realized(populated):
    r = T.get_trades(days=30)
    assert r['asOfDate'] == '2025-08-28' and r['historyStart'] == '2025-08-25'
    assert r['total'] == 4 and r['realized']['totalPnl'] == 1500.0
    ulty = next(s for s in r['summary'] if s['fund'] == 'ULTY')
    assert ulty['optionTrades'] == 2 and ulty['net'] == 5000.0 + 500.0 - 2000.0   # bought 100@50 + BC 0.50x10x100, sold 2.00x10x100
    only = T.get_trades(fund='slty', days=30)
    assert [t['fund'] for t in only['trades']] == ['SLTY']
    by_underlying = T.get_trades(ticker='afrm', days=30)
    assert by_underlying['total'] == 3                    # stock + both option legs
    assert T.get_trades(days=1)['total'] == 1             # window ends at latest date on file


def test_rest_and_mcp(populated):
    from fastapi.testclient import TestClient
    from api.server import app
    with TestClient(app) as c:
        r = c.get('/api/v1/trades?fund=ULTY&days=30')
        assert r.status_code == 200 and r.json()['fund' if False else 'total'] == 3
        assert r.headers['cache-control'] == 'public, max-age=300'
        assert c.get('/api/v1/trades?fund=BAD%20TICKER!').status_code == 422
        assert c.get('/api/v1/trades?days=0').status_code == 422
    from api import mcp_server
    out = mcp_server.get_trades.fn(fund='ULTY', days=30) if hasattr(mcp_server.get_trades, 'fn') else mcp_server.get_trades(fund='ULTY', days=30)
    assert out['total'] == 3
