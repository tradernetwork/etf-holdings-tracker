"""
API data-quality fields (docs/DATA_QUALITY_2026-09.md) — all additive:

  /api/v1/holdings   marketValue, fileDate, refreshed, stale on every row;
                     underlying, optionType (CALL/PUT), strike, expiry,
                     contracts (signed), isFlex on option rows.
  /api/v1/funds      lastHoldingsDate, stale, refreshed per fund.
  /api/v1/ticker/X   expired legs dropped; stale/fileDate per holding.

Synthetic snapshots keep these deterministic as the real history rolls.
"""
from api import data as d

AS_OF = '2026-09-25'  # a Friday


def _row(fund, ticker, **kw):
    base = {'ETF Ticker': fund, 'Ticker': ticker, 'Name': ticker, 'Weight': '1',
            'Share Quantity': '100', 'Market Value': '1000', 'Date': '2026-09-24',
            'Option_Type': '', 'Option_Strike': '', 'Option_Expiry': '', 'Underlying_Ticker': ''}
    base.update(kw)
    return base


def _opt(fund, occ, underlying, otype, strike, expiry, qty, **kw):
    return _row(fund, occ, Name=f'{underlying} {expiry} {strike} {otype[0]}', Option_Type=otype,
                Option_Strike=str(strike), Option_Expiry=expiry, Underlying_Ticker=underlying,
                **{'Share Quantity': str(qty)}, **kw)


LATEST = [
    _row('AMDY', 'AMD'),
    # Synthetic long: FLEX put at 490.01, long call at 490 (FLEX root prefix).
    _opt('AMDY', '2AMD  261016C00490000', 'AMD', 'Call', 490.0, '2026-10-16', 7420),
    _opt('AMDY', '2AMD  261016P00490010', 'AMD', 'Put', 490.01, '2026-10-16', -7420),
    # Listed short call.
    _opt('AMDY', 'AMD   261002C00650000', 'AMD', 'Call', 650.0, '2026-10-02', -900),
    # Frozen issuer: file date 8/14, leg expired 9/04.
    _row('EGGQ', 'AMD', Date='2026-08-14'),
    _opt('EGGQ', 'AMD   260904C00520000', 'AMD', 'Call', 520.0, '2026-09-04', -5, Date='2026-08-14'),
    # Carried forward by the scraper.
    _row('MSTY', 'MSTR', Date='2026-09-22', Source_Date='2026-09-22', Refreshed='False'),
    # Fresh, new-format row.
    _row('KQQQ', 'AMD', Date='2026-09-25', Source_Date='2026-09-25', Refreshed='True', Is_Flex=''),
]


def _patch(monkeypatch):
    monkeypatch.setattr(d, 'get_latest_holdings', lambda: LATEST)
    monkeypatch.setattr(d, 'get_previous_holdings', lambda: [])
    monkeypatch.setattr(d, 'get_as_of_date', lambda: AS_OF)
    monkeypatch.setattr(d, 'compute_daily_changes_with_options', lambda: [])


def test_helpers():
    assert d.previous_trading_day('2026-09-28') == '2026-09-25'  # Mon → Fri
    assert d.previous_trading_day('2026-09-25') == '2026-09-24'
    assert d.is_stale('2026-08-14', AS_OF)
    assert not d.is_stale('2026-09-24', AS_OF)  # T-1 is fresh
    assert not d.is_stale('2026-09-28', AS_OF)  # issuers that stamp T+1
    assert d._iso_date('08/14/2026') == '2026-08-14'
    assert d._iso_date('2026-08-14 00:00:00') == '2026-08-14'


def test_holdings_option_fields(monkeypatch):
    _patch(monkeypatch)
    rows = d.get_all_holdings()['holdings']
    put = next(r for r in rows if r['isOption'] and r['strike'] == 490.01)
    assert put['optionType'] == 'PUT'
    assert put['underlying'] == 'AMD'
    assert put['expiry'] == '2026-10-16'
    assert put['contracts'] == -7420 and put['shares'] == -7420  # `shares` unchanged
    assert put['isFlex'] is True
    assert put['marketValue'] == 1000
    listed = next(r for r in rows if r['isOption'] and r['strike'] == 650.0)
    assert listed['isFlex'] is False
    assert listed['optionType'] == 'CALL'


def test_holdings_equity_rows_have_null_option_fields(monkeypatch):
    _patch(monkeypatch)
    eq = next(r for r in d.get_all_holdings()['holdings'] if r['fund'] == 'AMDY' and not r['isOption'])
    assert eq['optionType'] is None and eq['isFlex'] is None and eq['contracts'] is None
    # Every pre-existing field is still present.
    for k in ('fund', 'ticker', 'name', 'sector', 'weight', 'shares', 'weightDelta',
              'sharesDelta', 'isOption', 'cusip'):
        assert k in eq


def test_holdings_provenance(monkeypatch):
    _patch(monkeypatch)
    rows = d.get_all_holdings()['holdings']
    by = {(r['fund'], r['ticker']): r for r in rows}
    assert by[('EGGQ', 'AMD')]['stale'] is True
    assert by[('EGGQ', 'AMD')]['fileDate'] == '2026-08-14'
    assert by[('EGGQ', 'AMD')]['refreshed'] is None  # old-format row: unknown
    assert by[('MSTY', 'MSTR')]['refreshed'] is False
    assert by[('MSTY', 'MSTR')]['stale'] is True
    assert by[('KQQQ', 'AMD')]['refreshed'] is True
    assert by[('KQQQ', 'AMD')]['stale'] is False


def test_funds_index_freshness(monkeypatch):
    _patch(monkeypatch)
    funds = {f['fund']: f for f in d.get_funds_index()}
    assert funds['EGGQ']['lastHoldingsDate'] == '2026-08-14' and funds['EGGQ']['stale'] is True
    assert funds['MSTY']['refreshed'] is False and funds['MSTY']['stale'] is True
    assert funds['AMDY']['lastHoldingsDate'] == '2026-09-24' and funds['AMDY']['stale'] is False
    assert funds['KQQQ']['refreshed'] is True


def test_ticker_detail_drops_expired_legs(monkeypatch):
    _patch(monkeypatch)
    detail = d.get_ticker_detail('AMD')
    legs = [h for h in detail['holdings'] if h['isOption']]
    assert all(h['optionDetails']['expiry'] >= AS_OF for h in legs)
    assert not any(h['fund'] == 'EGGQ' and h['isOption'] for h in detail['holdings'])
    eggq_stock = next(h for h in detail['holdings'] if h['fund'] == 'EGGQ')
    assert eggq_stock['stale'] is True
    synth_put = next(h for h in legs if h['optionDetails']['strike'] == 490.01)
    assert synth_put['optionDetails']['contracts'] == -7420
    assert synth_put['optionDetails']['isFlex'] is True
    assert synth_put['optionDetails']['type'] == 'Put'  # legacy casing kept
    assert synth_put['optionDetails']['optionType'] == 'PUT'
