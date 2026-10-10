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
