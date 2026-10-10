"""A fund coming back from carried-forward rows must not report its whole gap
as one day's trades (ARK, 2026-09-25 -> 2026-10-12)."""
import csv
import pytest
from api import data

FIELDS = ['ETF Ticker', 'Ticker', 'Name', 'Weight', 'Share Quantity', 'Market Value',
          'Sector', 'Option_Type', 'Refreshed', 'Source_Date', 'Date']


def snap(day, ark, other, ark_fresh=True, src='2026-09-25'):
    rows = []
    for t, w in ark.items():
        rows.append({'ETF Ticker': 'ARKK', 'Ticker': t, 'Name': t, 'Weight': w,
                     'Share Quantity': w * 1000, 'Market Value': w * 1e6, 'Sector': 'X',
                     'Refreshed': str(ark_fresh), 'Source_Date': day if ark_fresh else src,
                     'Date': day if ark_fresh else src})
    for t, w in other.items():
        rows.append({'ETF Ticker': 'AVUV', 'Ticker': t, 'Name': t, 'Weight': w,
                     'Share Quantity': w * 1000, 'Market Value': w * 1e6, 'Sector': 'X',
                     'Refreshed': 'True', 'Source_Date': day, 'Date': day})
    return day, rows


@pytest.fixture
def history(tmp_path, monkeypatch):
    def build(snaps):
        for day, rows in snaps:
            with (tmp_path / f'holdings_{day}.csv').open('w', newline='') as f:
                w = csv.DictWriter(f, fieldnames=FIELDS, restval='')
                w.writeheader(); w.writerows(rows)
        monkeypatch.setattr(data, 'HISTORY_DIR', str(tmp_path))
        data._read_csv.cache_clear() if hasattr(data._read_csv, 'cache_clear') else None
        data._available_dates.cache_clear()
    return build


def gap_then_fresh():
    # ARK carried from 09-25 for N market days, then fresh on 10-12 with a huge move.
    stale = {'TSLA': 10.0, 'COIN': 5.0}
    return [snap('2026-10-08', stale, {'AAA': 2.0}, ark_fresh=False),
            snap('2026-10-09', stale, {'AAA': 2.0}, ark_fresh=False),
            snap('2026-10-12', {'TSLA': 4.0, 'COIN': 9.0, 'NEW': 6.0}, {'AAA': 3.0})]


def test_catch_up_fund_is_excluded_from_daily_changes(history):
    history(gap_then_fresh())
    funds = {c['fund'] for c in data.compute_daily_changes()}
    assert 'ARKK' not in funds            # two weeks of trades are not "today"
    assert 'AVUV' in funds                # healthy funds are untouched


def test_catch_up_reported_with_since_date(history):
    history(gap_then_fresh())
    assert data.get_catch_up_funds() == {'ARKK': '2026-09-25'}
    assert data.get_full_payload()['catchUp'] == {'ARKK': '2026-09-25'}
    arkk = next(f for f in data.get_funds_index() if f['fund'] == 'ARKK')
    assert arkk['catchUp'] is True and arkk['catchUpSince'] == '2026-09-25'
    assert next(f for f in data.get_funds_index() if f['fund'] == 'AVUV')['catchUp'] is False


def test_window_starting_on_carried_rows_is_also_excluded(history):
    history(gap_then_fresh())
    for changes in (data.compute_weekly_changes(), data.compute_monthly_changes()):
        assert 'ARKK' not in {c['fund'] for c in changes}


def test_next_day_is_normal_again(history):
    snaps = gap_then_fresh() + [snap('2026-10-13', {'TSLA': 3.0, 'COIN': 9.0, 'NEW': 6.0}, {'AAA': 3.0})]
    history(snaps)
    assert data.get_catch_up_funds() == {}
    ark = [c for c in data.compute_daily_changes() if c['fund'] == 'ARKK']
    assert [c['ticker'] for c in ark] == ['TSLA']


def test_gap_does_not_seed_streaks_or_layering(history):
    history(gap_then_fresh() + [snap('2026-10-13', {'TSLA': 3.0, 'COIN': 9.0, 'NEW': 6.0}, {'AAA': 3.0}),
                                snap('2026-10-14', {'TSLA': 2.0, 'COIN': 9.0, 'NEW': 6.0}, {'AAA': 3.0})])
    streaks = data._compute_streaks()
    # TSLA fell on 10-13 and 10-14 (a real 2-day streak); the 10-12 catch-up
    # step (10 -> 4) must not extend it to 3.
    assert streaks.get(('ARKK', 'TSLA')) == -2


def test_still_stale_fund_is_not_a_catch_up(history):
    stale = {'TSLA': 10.0}
    history([snap('2026-10-08', stale, {'AAA': 2.0}, ark_fresh=False),
             snap('2026-10-09', stale, {'AAA': 2.0}, ark_fresh=False)])
    assert data.get_catch_up_funds() == {}


# ─── Paths that diff snapshots on their own ──────────────────────

def _inst(monkeypatch):
    monkeypatch.setattr(data, 'get_fund_aum', lambda f: 1.0)
    monkeypatch.setattr(data, 'is_institutional_fund', lambda f: True)
    data._institutional_flow_cached.cache_clear()
    data._institutional_trend_cached.cache_clear()


def _flow_delta(period, ticker):
    d = data._compute_institutional_flow(period, 100)
    return {r['ticker']: r['weightDelta'] for r in d['buying'] + d['selling']}.get(ticker, 0.0)


def test_institutional_flow_drops_catch_up_fund(history, monkeypatch):
    _inst(monkeypatch)
    history(gap_then_fresh())
    # ARK's TSLA 10 -> 4 and NEW +6 are the gap; they must not move the blend.
    assert _flow_delta('daily', 'TSLA') == 0.0
    assert _flow_delta('daily', 'NEW') == 0.0
    # Healthy fund unchanged: AVUV AAA 2 -> 3 = +1pp of its book, 1/2 of total AUM.
    assert _flow_delta('daily', 'AAA') == pytest.approx(0.5)


def test_institutional_trend_drops_catch_up_fund_per_horizon(history, monkeypatch):
    _inst(monkeypatch)
    history(gap_then_fresh())
    rows = {r['ticker']: r for r in data._compute_institutional_trend(100)['tickers']}
    assert 'TSLA' not in rows and 'NEW' not in rows     # ARK-only tickers: no daily/weekly/monthly
    assert rows['AAA']['daily'] == pytest.approx(0.5)


def test_signal_performance_emits_nothing_for_catch_up_step(tmp_path):
    from api import signal_performance as sp
    d = tmp_path / 'h'; d.mkdir()
    for day, rows in gap_then_fresh() + [snap('2026-10-13', {'TSLA': 3.0, 'COIN': 9.0, 'NEW': 6.0}, {'AAA': 3.0})]:
        with (d / f'holdings_{day}.csv').open('w', newline='') as f:
            w = csv.DictWriter(f, fieldnames=FIELDS, restval=''); w.writeheader(); w.writerows(rows)
    sigs = sp.generate_all_signals(str(d))
    ark = [(s['date'], s['ticker']) for s in sigs if s['fund'] == 'ARKK']
    assert not [a for a in ark if a[0] == '2026-10-12']       # the gap day emits nothing
    assert ('2026-10-13', 'TSLA') in ark                        # the next real day does
    assert ('2026-10-12', 'AAA') in [(s['date'], s['ticker']) for s in sigs if s['fund'] == 'AVUV']


# ─── Edge cases & the scraper invariant ──────────────────────────

def _rec(fund, ticker, refreshed='True', option=''):
    r = {'ETF Ticker': fund, 'Ticker': ticker, 'Weight': '1', 'Source_Date': '2026-09-25',
         'Option_Type': option}
    if refreshed is not None:
        r['Refreshed'] = refreshed
    return r


def test_partly_carried_fund_is_not_guarded():
    # Safe today only because the scraper stamps/carries a whole fund at once.
    prev = [_rec('ARKK', 'AAA', 'False'), _rec('ARKK', 'BBB', 'True')]
    assert data._catch_up_funds([_rec('ARKK', 'AAA'), _rec('ARKK', 'BBB')], prev) == {}


def test_unknown_current_flag_counts_as_fresh():
    assert data._catch_up_funds([_rec('ARKK', 'AAA', None)], [_rec('ARKK', 'AAA', 'False')]) \
        == {'ARKK': '2026-09-25'}
    assert data._catch_up_funds([_rec('ARKK', 'AAA', None)], [_rec('ARKK', 'AAA', None)]) == {}


def test_new_fund_and_still_carried_fund_are_not_catch_up():
    assert data._catch_up_funds([_rec('NEW', 'AAA')], []) == {}
    assert data._catch_up_funds([_rec('ARKK', 'AAA', 'False')], [_rec('ARKK', 'AAA', 'False')]) == {}


def test_scraper_carries_a_whole_fund_atomically(tmp_path):
    """The guard treats a half-carried fund as fresh, so the scraper must never
    produce one: every carried row of a fund is Refreshed=False."""
    import scrape_avantis as sa
    day = tmp_path / 'holdings_2026-10-09.csv'
    rows = [{'ETF Ticker': 'ARKK', 'Ticker': t, 'Name': t, 'Weight': 1, 'Refreshed': True,
             'Source_Date': '2026-09-25', 'Date': '2026-09-25'} for t in ('A', 'B', 'C')]
    import pandas as pd
    pd.DataFrame(rows).to_csv(day, index=False)
    cf = sa.carry_forward_rows('ARKK', '2026-10-12', history_dir=str(tmp_path))
    assert len(cf) == 3 and (cf['Refreshed'] == False).all()  # noqa: E712


# ─── Per-row deltas on /holdings and /fund ───────────────────────

def test_holdings_endpoint_nulls_catch_up_deltas(history):
    history(gap_then_fresh())
    rows = data.get_all_holdings()['holdings']
    ark = [r for r in rows if r['fund'] == 'ARKK']
    assert ark and all(r['weightDelta'] is None and r['sharesDelta'] is None for r in ark)
    assert all(r['catchUpSince'] == '2026-09-25' for r in ark)
    other = [r for r in rows if r['fund'] == 'AVUV'][0]
    assert other['weightDelta'] == 1.0 and 'catchUpSince' not in other


def test_fund_detail_nulls_catch_up_deltas_consistently(history):
    history(gap_then_fresh())
    d = data.get_fund_detail('ARKK')
    assert d['catchUp'] is True and d['catchUpSince'] == '2026-09-25'
    for h in d['topHoldings']:
        # all three agree: unknown, not a raw delta contradicting a 0 active delta
        assert h['weightDelta'] is None and h['sharesDelta'] is None
        assert h['activeWeightDelta'] is None
    healthy = data.get_fund_detail('AVUV')
    assert healthy['catchUp'] is False
    assert healthy['topHoldings'][0]['weightDelta'] == 1.0
