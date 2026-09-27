"""
Tests for api/income.py — option-income fund analytics.

The load-bearing property here is that an uncomputable metric comes back as
None, never 0. `Underlying_Price` is genuinely absent for several funds, and a
coverage tile reading "0.0%" when the honest answer is "we don't know" is worse
than showing nothing.
"""

import pytest

from api import income
from api.data import get_fund_category


def _row(**kw):
    base = {
        'ETF Ticker': 'TEST', 'Ticker': '', 'Name': '', 'Sector': '',
        'Weight': '0', 'Share Quantity': '0', 'Market Value': '',
        'Option_Type': '', 'Option_Strike': '', 'Option_Expiry': '',
        'Underlying_Ticker': '', 'Underlying_Price': '', 'DTE': '',
        'Moneyness': '', 'NetAssets': '',
    }
    base.update(kw)
    return base


# ─── Sleeve bucketing ────────────────────────────────────────────────────────

@pytest.mark.parametrize("name,ticker,expected", [
    ("US TREASURY BILL 08/14/26", "B", "treasury"),
    ("ROUNDHILL WEEK", "WEEK", "treasury"),
    ("Invesco Government & Agency Portfolio", "AGPXX", "cash"),
    ("NVIDIA CORP WEEKLYPAY SWAP NM", "NVDA", "swap"),
    ("Analog Devices Inc", "ADI", "equity"),
])
def test_sleeve_bucketing(name, ticker, expected):
    assert income._sleeve_of(_row(Name=name, Ticker=ticker)) == expected


# ─── Archetype classification ────────────────────────────────────────────────

def test_classify_covered_call():
    assert income._classify(
        {'equity': 100.5, 'cash': 2.8}, {'long': 1.5, 'short': -4.8}, 69, 27,
    ) == 'covered-call'


def test_classify_synthetic_no_shares():
    """MSTY-shaped: Treasuries plus a replicating options structure."""
    assert income._classify(
        {'equity': 25.8, 'treasury': 75.7}, {'long': 10.7, 'short': -12.2}, 22, 4,
    ) == 'synthetic'


def test_classify_leap_proxy_when_nothing_is_written():
    """QDTE-shaped: long index calls carry the exposure, nothing short."""
    assert income._classify(
        {'equity': 3.7, 'treasury': 5.2}, {'long': 91.0, 'short': 0.0}, 4, 1,
    ) == 'leap-proxy'


def test_classify_swap_when_no_options_at_all():
    assert income._classify(
        {'equity': 18.9, 'swap': 81.1}, {'long': 0.0, 'short': 0.0}, 0, 2,
    ) == 'swap'


def test_classify_short_equity():
    assert income._classify(
        {'equity': -10.7, 'treasury': 90.1}, {'long': 1.1, 'short': -1.9}, 67, 12,
    ) == 'short-equity'


# ─── Spot resolution ─────────────────────────────────────────────────────────

def test_spot_prefers_the_funds_own_mark():
    """Same source as the position the calls are written against."""
    spot, suppressed = income._resolve_spot(100.0, 101.0)
    assert spot == 100.0 and not suppressed


def test_spot_falls_back_to_the_quote_feed():
    spot, suppressed = income._resolve_spot(None, 101.0)
    assert spot == 101.0 and not suppressed


def test_spot_suppressed_on_material_disagreement():
    """RDDT was marked $178.04 by the funds and quoted $137.60 — 22.7% apart."""
    spot, suppressed = income._resolve_spot(178.04, 137.60)
    assert spot is None and suppressed


def test_spot_none_when_neither_source_has_it():
    assert income._resolve_spot(None, None) == (None, False)


# ─── NAV derivation ──────────────────────────────────────────────────────────

def test_nav_read_directly_when_present():
    assert income._fund_nav([_row(NetAssets='738692445.98')]) == pytest.approx(738692445.98)


def test_nav_derived_from_weight_when_netassets_blank():
    """Kurv and REX leave NetAssets empty — derive from any priced row."""
    nav = income._fund_nav([_row(**{'Market Value': '1000000', 'Weight': '2.0'})])
    assert nav == pytest.approx(50_000_000)


def test_nav_none_when_underivable():
    assert income._fund_nav([_row()]) is None


# ─── Book assembly ───────────────────────────────────────────────────────────

def _covered_call_fund():
    return [
        _row(Ticker='AAA', Name='Alpha Inc', Weight='10.0',
             **{'Share Quantity': '10000', 'Market Value': '1000000', 'NetAssets': '10000000'}),
        # Written call: negative quantity, strike above spot ($100).
        _row(Ticker='AAA  260814C00110000', Name='AAA CALL', Weight='-0.5',
             Option_Type='Call', Option_Strike='110', Option_Expiry='2026-08-14',
             Underlying_Ticker='AAA', Underlying_Price='100', DTE='7', Moneyness='-0.0909',
             **{'Share Quantity': '-100'}),
        # Protective put the fund BOUGHT — positive quantity.
        _row(Ticker='AAA  260814P00090000', Name='AAA PUT', Weight='0.2',
             Option_Type='Put', Option_Strike='90', Option_Expiry='2026-08-14',
             Underlying_Ticker='AAA', Underlying_Price='100', DTE='7',
             **{'Share Quantity': '50'}),
    ]


def test_book_collapses_to_one_row_per_underlying():
    book = income.build_fund_book('TEST', _covered_call_fund())
    assert len(book['book']) == 1
    assert book['counts']['optionLegs'] == 2  # a written call and a bought put
    assert book['book'][0]['underlying'] == 'AAA'
    assert book['book'][0]['legCount'] == 2


def test_written_call_identified_by_negative_quantity():
    row = income.build_fund_book('TEST', _covered_call_fund())['book'][0]
    assert row['writtenCall'] is not None
    assert row['writtenCall']['strike'] == 110.0
    assert row['writtenCall']['written'] is True


def test_bought_put_is_not_counted_as_written():
    """classifyOption used to label any put a 'cash-secured put' regardless of sign."""
    row = income.build_fund_book('TEST', _covered_call_fund())['book'][0]
    assert row['writtenPutCount'] == 0
    assert len(row['longLegs']) == 1
    assert row['longLegs'][0]['optionType'] == 'Put'


def test_upside_room_is_relative_to_spot_not_strike():
    """Room = (K-S)/S — what the holder keeps. Moneyness is (S-K)/K."""
    row = income.build_fund_book('TEST', _covered_call_fund())['book'][0]
    assert row['upsideRoomPct'] == pytest.approx(10.0)  # (110-100)/100
    assert row['capped'] is False


def test_capped_when_spot_is_above_the_written_strike():
    rows = _covered_call_fund()
    rows[1]['Option_Strike'] = '90'  # written below spot
    row = income.build_fund_book('TEST', rows)['book'][0]
    assert row['capped'] is True
    assert row['upsideRoomPct'] < 0


def test_coverage_capped_at_one_hundred_percent():
    rows = _covered_call_fund()
    rows[1]['Share Quantity'] = '-99999'  # absurd over-write
    row = income.build_fund_book('TEST', rows)['book'][0]
    assert row['coveredFraction'] == 1.0


# ─── Tiles are null, never zero, when uncomputable ───────────────────────────

def test_moneyness_none_when_column_blank():
    """MSTY-shaped: no Underlying_Price, so no honest moneyness."""
    rows = _covered_call_fund()
    for r in rows:
        r['Moneyness'] = ''
        r['Underlying_Price'] = ''
    tiles = income.build_fund_book('TEST', rows)['tiles']
    assert tiles['weightedMoneynessPct'] is None


def test_notional_none_when_spot_missing():
    rows = _covered_call_fund()
    for r in rows:
        r['Underlying_Price'] = ''
    tiles = income.build_fund_book('TEST', rows)['tiles']
    assert tiles['callNotionalPctNav'] is None
    assert tiles['putNotionalPctNav'] is None


def test_dte_survives_when_moneyness_does_not():
    """DTE is populated for every option row even where spot isn't."""
    rows = _covered_call_fund()
    for r in rows:
        r['Underlying_Price'] = ''
        r['Moneyness'] = ''
    tiles = income.build_fund_book('TEST', rows)['tiles']
    assert tiles['weightedDte'] == pytest.approx(7.0)


# ─── Live data ───────────────────────────────────────────────────────────────

def test_overview_covers_every_income_fund():
    o = income.get_income_overview()
    assert o['fundCount'] > 0
    assert all(get_fund_category(f['fund']) == 'option-income' for f in o['funds'])


def test_leap_proxy_funds_declare_their_income_leg_invisible():
    """QDTE/XDTE/RDTE write 0DTE contracts that never reach an EOD file."""
    o = income.get_income_overview()
    for f in o['funds']:
        if f['archetype'] == 'leap-proxy':
            assert f['incomeLegVisible'] is False, f['fund']
        else:
            assert f['incomeLegVisible'] is True, f['fund']


def test_equity_fund_is_not_served_by_the_income_endpoint():
    assert income.get_income_fund('ARKK') is None


def test_known_fund_shapes():
    """Spot-check the classifier against funds whose structure we know."""
    o = {f['fund']: f for f in income.get_income_overview()['funds']}
    # QDTE (Roundhill) is typically in the data even when YieldMax is absent.
    if 'QDTE' in o:
        assert o['QDTE']['archetype'] == 'leap-proxy'
    # YieldMax scrapes can fail independently — skip rather than fail hard when
    # their data is absent so a partial scrape doesn't block unrelated PRs.
    if 'ULTY' not in o or 'MSTY' not in o:
        pytest.skip("YieldMax data absent from today's holdings (partial scrape?)")
    assert o['ULTY']['archetype'] == 'covered-call'
    assert o['MSTY']['archetype'] == 'synthetic'
    # ULTY writes a call against essentially the whole sleeve.
    assert o['ULTY']['tiles']['callCoveragePct'] > 90


# ─── Brokerage-style positions view ─────────────────────────────────────────

def _stock(ticker, shares, price, weight=10.0):
    return {'Ticker': ticker, 'Name': f'{ticker} Inc', 'Share Quantity': str(shares),
            'Market Value': str(shares * price), 'Weight': str(weight)}


def _leg(underlying, otype, contracts, strike, expiry='2026-10-02', dte='7', spot='100', mv='0'):
    return {'Ticker': f'{underlying} {expiry} {strike}', 'Underlying_Ticker': underlying,
            'Option_Type': otype, 'Share Quantity': str(contracts), 'Option_Strike': str(strike),
            'Option_Expiry': expiry, 'DTE': dte, 'Underlying_Price': spot,
            'Market Value': mv, 'Weight': '-0.1' if contracts < 0 else '0.1'}


def test_positions_partial_coverage():
    """1,000 shares, 4 written calls → 40% of the position is covered."""
    positions, _, summary = income.build_positions(
        [_stock('AAA', 1000, 100.0)], [_leg('AAA', 'Call', -4, 110)], nav=1_000_000)
    p = positions[0]
    assert p['coveragePct'] == 40.0
    assert p['nakedShares'] == 0
    assert summary['coveredPct'] == 40.0 and summary['uncoveredPct'] == 60.0


def test_positions_synthetic_shares_count_as_stock():
    """No shares held, a 10-lot synthetic long, 10 written calls → fully covered.
    Counting only real shares would read this as 0% (and 1,000 naked)."""
    legs = [_leg('MMM', 'Call', 10, 95.0, expiry='2026-12-18', dte='84'),
            _leg('MMM', 'Put', -10, 95.01, expiry='2026-12-18', dte='84'),
            _leg('MMM', 'Call', -10, 110)]
    positions, _, summary = income.build_positions([], legs, nav=1_000_000)
    p = positions[0]
    assert p['sharesHeld'] == 0 and p['syntheticShares'] == 1000
    assert p['coveragePct'] == 100.0
    assert p['nakedShares'] == 0
    assert summary['syntheticPct'] == 100.0
    assert sorted(l['role'] for l in p['legs']) == ['synthetic', 'synthetic', 'written-call']


def test_positions_call_spread_is_not_naked():
    """Written beyond the shares held, but capped by long calls — not naked."""
    legs = [_leg('AAA', 'Call', -15, 110), _leg('AAA', 'Call', 5, 120)]
    positions, _, _ = income.build_positions([_stock('AAA', 1000, 100.0)], legs, nav=None)
    assert positions[0]['coveragePct'] == 100.0
    assert positions[0]['nakedShares'] == 0


def test_positions_uncapped_overwrite_is_naked():
    positions, _, _ = income.build_positions(
        [_stock('AAA', 1000, 100.0)], [_leg('AAA', 'Call', -15, 110)], nav=None)
    assert positions[0]['nakedShares'] == 500


def test_positions_short_stock_covered_by_written_puts():
    positions, _, _ = income.build_positions(
        [_stock('SSS', -1000, 50.0, weight=-5.0)], [_leg('SSS', 'Put', -10, 45, spot='50')], nav=None)
    assert positions[0]['coveragePct'] == 100.0


def test_positions_expired_calls_do_not_cover():
    positions, _, _ = income.build_positions(
        [_stock('AAA', 1000, 100.0)], [_leg('AAA', 'Call', -10, 110, dte='-3')], nav=None)
    assert positions[0]['coveragePct'] == 0.0
    assert positions[0]['legs'][0]['expired'] is True


def test_positions_collapse_cash_and_tbills():
    eq = [_stock('AAA', 1000, 100.0),
          {'Ticker': '912797TC1', 'Name': 'United States Treasury Bill', 'Share Quantity': '500000',
           'Market Value': '495000', 'Weight': '40'},
          {'Ticker': 'FGXXX', 'Name': 'First American Government Obligations', 'Share Quantity': '5000',
           'Market Value': '5000', 'Weight': '1'}]
    positions, others, _ = income.build_positions(eq, [], nav=None)
    assert [p['ticker'] for p in positions] == ['AAA']
    assert {o['sleeve'] for o in others} == {'treasury', 'cash'}
