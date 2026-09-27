"""
Unit tests for the effectiveness engine's robustness fixes.

These use synthetic option rows (not the rolling CSV history) so they stay
deterministic as daily snapshots change. They lock in three fixes:

  1. Strike selection withholds a score when too few legs carry moneyness
     (data-confidence floor) — instead of grading off a single outlier.
  2. Strike selection falls back to equal weighting when the underlying-price
     (notional) feed is degenerate, so one sized leg can't dominate.
  3. DTE management scores calls and puts as separate cadences, so a fund
     writing weekly calls alongside long-dated protective puts isn't zeroed.

Plus the leg-classification fixes: synthetic-stock pairs (long call + short
put) and expired legs are not income writes, cash/T-bills are not delta, and
the peer-group label is measured from the write cycle rather than hardcoded.
"""
import effectiveness as e


def _opt(otype, qty, moneyness=None, underlying_price=100.0, dte=7.0,
         strike=100.0, underlying='XYZ', expiry='2026-10-02', mv=0.0):
    """Build a minimal option row understood by the compute_* functions."""
    return {
        'Option_Type': otype,
        'Share Quantity': str(qty),
        'Moneyness': '' if moneyness is None else str(moneyness),
        'Underlying_Price': '' if underlying_price is None else str(underlying_price),
        'DTE': str(dte),
        'Option_Strike': str(strike),
        'Underlying_Ticker': underlying,
        'Option_Expiry': expiry,
        'Market Value': str(mv),
    }


def _equity(ticker, qty):
    return {'Ticker': ticker, 'Share Quantity': str(qty)}


def _kqqq_style_book():
    """Two-week income calls + a synthetic long (long call / short put, same
    strike, ~quarterly) on the same name — the shape KQQQ and the YieldMax
    single-name funds actually hold."""
    return [
        _opt('Call', -100, moneyness=-0.08, dte=7.0, strike=108, expiry='2026-10-02', mv=-5000),
        _opt('Call', 100, moneyness=0.0, dte=84.0, strike=100, expiry='2026-12-18', mv=90000),
        _opt('Put', -100, moneyness=0.0, dte=84.0, strike=100.01, expiry='2026-12-18', mv=-85000),
    ]


def test_strike_score_withheld_when_moneyness_sparse():
    """1 of 5 written legs carries moneyness -> insufficient data -> score None."""
    opts = [_opt('Call', -100, moneyness=-0.08)]
    opts += [_opt('Call', -100, moneyness=None) for _ in range(4)]
    res = e.compute_strike_selection(opts, fund='EGGQ')
    assert res['dataCoverage'] == 0.2
    assert res['score'] is None


def test_strike_score_present_when_coverage_ok():
    """All legs carry moneyness near the profile center -> a real score."""
    opts = [_opt('Call', -100, moneyness=-0.08) for _ in range(5)]
    res = e.compute_strike_selection(opts, fund='EGGS')  # call center ~ -0.08
    assert res['dataCoverage'] == 1.0
    assert res['score'] is not None
    assert res['score'] > 80  # on-center, tightly clustered


def test_equal_weight_fallback_when_notional_degenerate():
    """One leg has an underlying price, the rest don't: the sized outlier must
    NOT capture the whole score. Equal weighting keeps it representative."""
    # Four on-center legs (no notional) + one far-off outlier (has notional).
    opts = [_opt('Call', -100, moneyness=-0.08, underlying_price=None) for _ in range(4)]
    opts.append(_opt('Call', -100, moneyness=-0.40, underlying_price=500.0))
    res = e.compute_strike_selection(opts, fund='EGGS')
    # Notional weighting would hand the score to the -0.40 outlier (~0).
    # Equal weighting across the five legs should keep it well above that.
    assert res['score'] is not None
    assert res['score'] > 50


def test_dte_calls_and_puts_scored_separately():
    """Weekly income calls + long-dated protective puts must not blend into a
    single mean that zeroes the score."""
    # KYLD-style profile (~6 DTE target). Calls weekly, puts quarterly.
    opts = [_opt('Call', -100, moneyness=-0.09, dte=6.0) for _ in range(8)]
    opts += [_opt('Put', -100, moneyness=-0.10, dte=98.0) for _ in range(4)]
    res = e.compute_dte_management(opts, fund='KYLD')
    # Blended mean (~36 DTE) would score ~0 against a 6-DTE center.
    # Per-leg scoring credits the weekly call cadence.
    assert res['score'] is not None
    assert res['score'] > 25


def test_analyze_fund_falls_back_over_scrape_gap():
    """analyze_fund must not return None just because the latest snapshot
    dropped a fund's option legs — it walks back to the last good day."""
    res = e.analyze_fund('ULTI')
    if res is None:
        # Only valid if ULTI has no option legs in ANY snapshot.
        assert all(
            not e.get_fund_options(e.get_holdings_for_date(d), 'ULTI')
            for d in e.get_available_dates()
        )
    else:
        assert 'dataStale' in res
        assert 'staleSnapshots' in res
        # asOfDate must be a snapshot that actually has ULTI options.
        opts = e.get_fund_options(e.get_holdings_for_date(res['asOfDate']), 'ULTI')
        assert len(opts) > 0


def test_synthetic_pair_detected_with_cent_strike_offset():
    """Long call + short put, same size/expiry, strikes a cent apart (MSTY
    pairs 95.00 with 95.01) is one synthetic long of 100 shares/contract."""
    other, synth, shares = e.split_synthetic_legs(_kqqq_style_book())
    assert len(synth) == 2
    assert [o['Option_Type'] for o in other] == ['Call']
    assert shares == {'XYZ': 10000.0}


def test_mismatched_size_is_not_synthetic():
    book = [_opt('Call', 100, strike=100, dte=84), _opt('Put', -50, strike=100, dte=84)]
    _, synth, _ = e.split_synthetic_legs(book)
    assert synth == []


def test_synthetic_short_put_excluded_from_dte_and_strike():
    """The synthetic's ~84 DTE short put must not drag DTE Management or be
    graded on moneyness as an income put."""
    book = _kqqq_style_book()
    dte = e.compute_dte_management(book, fund='KQQQ')
    assert dte['avgDTE'] == 7.0
    assert dte['distribution'] == {'weekly': 1, 'biweekly': 0, 'monthly': 0, 'longDated': 0}
    strike = e.compute_strike_selection(book, fund='KQQQ')
    assert strike['putCount'] == 0
    assert strike['writtenCount'] == 1


def test_synthetic_long_covers_calls_and_is_not_a_collar():
    """A short call on a name held via synthetic long is covered, not naked,
    and the synthetic's own legs are not a 'collar'."""
    book = _kqqq_style_book()
    spread = e.compute_spread_efficiency(book, equities=[])
    assert spread['nakedCount'] == 0
    assert spread['coveredCount'] == 1
    assert spread['syntheticCount'] == 1
    hedge = e.compute_hedge_ratio(book, equities=[])
    assert hedge['collarCount'] == 0
    assert hedge['coverageRatio'] == 1.0


def test_synthetic_legs_not_counted_as_premium_bought():
    """The synthetic's long call is stock replication, not protection."""
    prem = e.compute_premium_capture(_kqqq_style_book(), net_assets=1_000_000)
    assert prem['totalPremiumBought'] == 0
    assert prem['totalPremiumWritten'] == 5000
    assert prem['netPremium'] == 5000


def test_short_stock_covers_written_puts():
    """SLTY writes puts against shorted stock — covered, not naked."""
    book = [_opt('Put', -100, moneyness=-0.03, dte=7.0, strike=95)]
    spread = e.compute_spread_efficiency(book, equities=[_equity('XYZ', -10000)])
    assert spread['nakedCount'] == 0
    assert spread['coveredCount'] == 1


def test_expired_legs_are_not_scored():
    """A lingering expired contract (frozen feed) is not an income write."""
    book = [_opt('Call', -100, moneyness=-0.08, dte=-5.0)]
    assert e.compute_dte_management(book, fund='KQQQ')['score'] is None
    assert e.compute_strike_selection(book, fund='KQQQ')['score'] is None
    assert e.compute_hedge_ratio(book, equities=[])['score'] is None


def test_hedge_delta_ignores_cash_and_tbills():
    """Only stock the options are written on counts toward delta. T-bill par
    and cash used to be added as shares and swamped the book."""
    book = [_opt('Call', -100, dte=7.0, strike=100)]
    stock_only = e.compute_hedge_ratio(book, [_equity('XYZ', 10000)])
    with_cash = e.compute_hedge_ratio(
        book, [_equity('XYZ', 10000), _equity('912797TV9', 5_000_000), _equity('Cash&Other', 2_000_000)])
    assert with_cash == stock_only


def test_collar_requires_stock_and_protective_put():
    book = [_opt('Call', -100, dte=7.0, strike=108), _opt('Put', 100, dte=7.0, strike=92)]
    assert e.compute_hedge_ratio(book, [_equity('XYZ', 10000)])['collarCount'] == 1
    assert e.compute_hedge_ratio(book, [])['collarCount'] == 0


def test_cadence_label_bands():
    assert e._cadence_label(7) == 'weekly'
    assert e._cadence_label(14) == 'biweekly'
    assert e._cadence_label(28) == 'monthly'


def test_detect_write_cadence_two_week_cycle(monkeypatch):
    """KQQQ-style: the primary written expiry advances two weeks at a time.
    A single stray weekly leg alongside must not flip it to 'weekly'."""
    snaps = {}
    cycle = [('2026-08-10', '2026-08-21'), ('2026-08-24', '2026-09-04'),
             ('2026-09-07', '2026-09-18'), ('2026-09-21', '2026-10-02')]
    for snap, exp in cycle:
        rows = [dict(_opt('Call', -100, strike=110, expiry=exp), **{'ETF Ticker': 'ZZZ'})
                for _ in range(5)]
        # One small stray leg on a different expiry
        rows.append(dict(_opt('Call', -1, strike=110, expiry='2026-10-16'), **{'ETF Ticker': 'ZZZ'}))
        snaps[snap] = rows
    monkeypatch.setattr(e, 'get_holdings_for_date', lambda d: snaps.get(d, []))
    res = e.detect_write_cadence('ZZZ', sorted(snaps, reverse=True))
    assert res == {'label': 'biweekly', 'days': 14.0}


def test_kqqq_not_labelled_weekly():
    """Regression: KQQQ moved to a two-week call cycle in mid-2026 and the
    effectiveness page kept calling it 'weekly'."""
    res = e.analyze_fund('KQQQ')
    if res is None:
        return  # no KQQQ option history in this checkout
    if res['writeCadenceDays'] is not None:
        assert res['peerGroup'] == e._cadence_label(res['writeCadenceDays'])
    else:
        assert res['peerGroup'] == 'biweekly'  # profile fallback
