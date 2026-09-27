"""
Scraper data-quality guards (docs/DATA_QUALITY_2026-09.md):

  1. NestYield moved its holdings to dated, versioned media uploads; the
     current link is discovered from the fund page.
  2. A 200 response that isn't a CSV (YieldMax's intermittent HTML/challenge
     page) is recognised as such instead of dying inside pandas.
  3. A fund that still fails is carried forward, marked Refreshed=False with
     the date its data is really from, never silently dropped.
  4. FLEX option legs are flagged.
"""
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import scrape_avantis as s  # noqa: E402

# Trimmed from https://nestyield.com/eggq/ (2026-09-27): the page links both
# the frozen fixed URL and several dated uploads.
NESTYIELD_PAGE = """
<a href="https://nestyield.com/wp-content/uploads/data/TidalFG_Holdings_EGGQ.csv">old</a>
<a href="https://nestyield.com/wp-content/uploads/2026/08/TidalFG_Holdings_EGGQ-7.csv">Aug</a>
<a class="btn" href='https://nestyield.com/wp-content/uploads/2026/09/TidalFG_Holdings_EGGQ-10.csv'>Download</a>
<a href="https://nestyield.com/wp-content/uploads/2026/09/TidalFG_Holdings_EGGQ-9.csv">prev</a>
<a href="https://nestyield.com/wp-content/uploads/2026/09/TidalFG_Holdings_EGGY-12.csv">other fund</a>
"""


# ─── 1. NestYield discovery ─────────────────────────────────────────────────

def test_discovers_newest_dated_upload():
    assert s.discover_upload_csv(NESTYIELD_PAGE, 'EGGQ') == \
        'https://nestyield.com/wp-content/uploads/2026/09/TidalFG_Holdings_EGGQ-10.csv'


def test_discovery_ignores_other_funds_and_the_frozen_url():
    assert s.discover_upload_csv(NESTYIELD_PAGE, 'EGGY').endswith('/2026/09/TidalFG_Holdings_EGGY-12.csv')
    assert s.discover_upload_csv(NESTYIELD_PAGE, 'EGGS') is None


def test_unsuffixed_upload_is_version_zero():
    html = ('/wp-content/uploads/2026/10/TidalFG_Holdings_EGGQ.csv '
            'https://nestyield.com/wp-content/uploads/2026/10/TidalFG_Holdings_EGGQ.csv '
            'https://nestyield.com/wp-content/uploads/2026/09/TidalFG_Holdings_EGGQ-10.csv')
    # A newer month wins even without a version suffix.
    assert s.discover_upload_csv(html, 'EGGQ').endswith('/2026/10/TidalFG_Holdings_EGGQ.csv')


def test_nestyield_funds_are_configured_for_discovery():
    nest = {f['ticker']: f for f in s.FUNDS if f['ticker'] in ('EGGQ', 'EGGY', 'EGGS')}
    assert set(nest) == {'EGGQ', 'EGGY', 'EGGS'}
    for t, f in nest.items():
        assert f['page'] == f'https://nestyield.com/{t.lower()}/'
        assert f['url']  # fallback kept


# ─── 2. Non-CSV 200 responses ───────────────────────────────────────────────

def test_real_holdings_header_is_a_csv():
    lines = ['Date,Account,StockTicker,CUSIP,SecurityName,Shares,Price,MarketValue,Weightings',
             '09/25/2026,MSTY,MSTR,123,Strategy,1,1,1,1%']
    assert s.looks_like_holdings_csv(lines)


def test_html_page_is_not_a_csv():
    # The shape that produced "Expected 1 fields in line 5, saw 2" on 9/23.
    lines = ['<!DOCTYPE html>', '<html lang="en-US">', '<head>', '<meta charset="UTF-8">',
             '<title>Just a moment...</title>, <meta name="robots">']
    assert not s.looks_like_holdings_csv(lines)


def test_single_word_first_line_is_not_a_csv():
    assert not s.looks_like_holdings_csv(['Maintenance', 'Please try later, thanks'])
    assert not s.looks_like_holdings_csv([])


def test_non_csv_response_fails_the_fund_not_the_run(monkeypatch):
    class _Resp:
        status_code = 200
        headers = {'content-type': 'text/html; charset=UTF-8'}
        content = b'<!DOCTYPE html>\n<html>\n<head>\n<title>x</title>\n<p>a, b</p>\n'
        def raise_for_status(self):
            pass
    monkeypatch.setattr(s, '_http_get', lambda *a, **k: _Resp())
    monkeypatch.setattr(s, 'log', lambda *_: None)
    assert s.get_holdings_csv({'ticker': 'MSTY', 'type': 'csv', 'url': 'https://example/x.csv'}) is None


# ─── 3. Carry forward ───────────────────────────────────────────────────────

def _history(tmp_path, day, rows):
    df = pd.DataFrame(rows)
    df.to_csv(tmp_path / f'holdings_{day}.csv', index=False)


def test_failed_fund_is_carried_forward_and_marked(tmp_path):
    _history(tmp_path, '2026-09-22', [
        {'ETF Ticker': 'MSTY', 'Ticker': 'MSTR  261002C00172500', 'Name': 'MSTR 10/02/26 C172.5',
         'Date': '2026-09-22', 'Share Quantity': '-19000', 'Market Value': '-3420000', 'Weight': '-0.3',
         'Option_Type': 'Call', 'Option_Strike': '172.5', 'Option_Expiry': '2026-10-02', 'DTE': '10'},
        {'ETF Ticker': 'ULTY', 'Ticker': 'AMD', 'Name': 'AMD', 'Date': '2026-09-22',
         'Share Quantity': '100', 'Market Value': '1', 'Weight': '1',
         'Option_Type': '', 'Option_Strike': '', 'Option_Expiry': '', 'DTE': ''},
    ])
    rows = s.carry_forward_rows('MSTY', '2026-09-23', history_dir=str(tmp_path))
    assert len(rows) == 1
    r = rows.iloc[0]
    assert r['Refreshed'] is False or r['Refreshed'] == False  # noqa: E712
    assert r['Source_Date'] == '2026-09-22'
    assert r['DTE'] == 9  # recomputed for the run date
    assert r['Share Quantity'] == -19000  # numeric, sign preserved
    assert r['Is_Flex'] is False or r['Is_Flex'] == False  # noqa: E712


def test_carry_forward_keeps_original_source_date_across_days(tmp_path):
    """Failing three days running must still report the first day's date."""
    _history(tmp_path, '2026-09-24', [
        {'ETF Ticker': 'MSTY', 'Ticker': 'MSTR', 'Name': 'x', 'Date': '2026-09-22',
         'Source_Date': '2026-09-22', 'Refreshed': 'False', 'Share Quantity': '1',
         'Market Value': '1', 'Weight': '1'},
    ])
    rows = s.carry_forward_rows('MSTY', '2026-09-25', history_dir=str(tmp_path))
    assert rows.iloc[0]['Source_Date'] == '2026-09-22'


def test_carry_forward_reads_the_newest_earlier_file_only(tmp_path):
    _history(tmp_path, '2026-09-21', [{'ETF Ticker': 'MSTY', 'Ticker': 'OLD', 'Name': 'x', 'Date': '2026-09-21'}])
    _history(tmp_path, '2026-09-22', [{'ETF Ticker': 'MSTY', 'Ticker': 'NEW', 'Name': 'x', 'Date': '2026-09-22'}])
    # A same-day file (e.g. a re-run) must not be read back as "yesterday".
    _history(tmp_path, '2026-09-23', [{'ETF Ticker': 'MSTY', 'Ticker': 'TODAY', 'Name': 'x', 'Date': '2026-09-23'}])
    rows = s.carry_forward_rows('MSTY', '2026-09-23', history_dir=str(tmp_path))
    assert list(rows['Ticker']) == ['NEW']


def test_nothing_to_carry(tmp_path):
    assert s.carry_forward_rows('MSTY', '2026-09-23', history_dir=str(tmp_path)) is None
    _history(tmp_path, '2026-09-22', [{'ETF Ticker': 'ULTY', 'Ticker': 'A', 'Name': 'x', 'Date': '2026-09-22'}])
    assert s.carry_forward_rows('MSTY', '2026-09-23', history_dir=str(tmp_path)) is None


def test_fresh_rows_get_quality_columns():
    df = pd.DataFrame([
        {'Ticker': '2AMAT 261218C00440000', 'Name': 'x', 'Date': '2026-09-25',
         'Option_Type': 'Call', 'Option_Strike': 440.0},
        {'Ticker': 'AMAT', 'Name': 'Applied', 'Date': '2026-09-25', 'Option_Type': None, 'Option_Strike': None},
    ])
    out = s.add_quality_columns(df, refreshed=True)
    assert list(out['Refreshed']) == [True, True]
    assert list(out['Source_Date']) == ['2026-09-25', '2026-09-25']
    assert out['Is_Flex'].iloc[0] is True
    assert out['Is_Flex'].iloc[1] is None


# ─── 4. FLEX ────────────────────────────────────────────────────────────────

def test_flex_by_occ_root_prefix():
    assert s.is_flex_option('2AMAT 261218C00440000', '', 440.0)       # ordinary strike, FLEX root
    assert s.is_flex_option('OTHER', '2MSTR 261120P00135010', 135.01)


def test_flex_by_off_grid_strike():
    assert s.is_flex_option('AMDY', 'AMD US 12/18/26 P490.01', 490.01)
    assert s.is_flex_option('X', 'x', '95.01')


def test_listed_contracts_are_not_flex():
    for strike in (440, 232.5, 1.25, 17.75, 0.5):
        assert not s.is_flex_option('AAPL  261218C00440000', 'AAPL', strike)
    assert not s.is_flex_option('MSTR  261002C00172500', 'MSTR US 10/02/26 C172.5', 172.5)
    assert not s.is_flex_option('X', 'x', None)


# ─── main(): retry passes + carry-forward, end to end ───────────────────────

def test_main_retries_then_carries_forward(tmp_path, monkeypatch):
    """A fund that fails once is retried and succeeds; a fund that fails every
    pass is carried forward — neither disappears from the output file."""
    _history(tmp_path, '2026-09-22', [
        {'ETF Ticker': 'BAD', 'Ticker': 'X', 'Name': 'x', 'Date': '2026-09-22',
         'Share Quantity': '1', 'Market Value': '1', 'Weight': '100'},
    ])
    calls = {'FLAKY': 0, 'BAD': 0, 'OK': 0, 'OK2': 0, 'OK3': 0}

    def fake_fetch(fund):
        t = fund['ticker']
        calls[t] += 1
        if t == 'BAD' or (t == 'FLAKY' and calls[t] == 1):
            return None
        return pd.DataFrame([{'Ticker': t, 'Name': t, 'Date': '2026-09-23',
                              'Share Quantity': 1, 'Market Value': 1, 'Weight': 100}])

    class _Today(s.datetime.date):
        @classmethod
        def today(cls):
            return cls(2026, 9, 23)

    out_csv = tmp_path / 'normalized_holdings.csv'
    monkeypatch.setattr(s.datetime, 'date', _Today)
    # 1 of 5 still failing = 20%, under the scraper's 25% abort threshold.
    monkeypatch.setattr(s, 'FUNDS', [{'ticker': t, 'type': 'csv'} for t in ('OK', 'OK2', 'OK3', 'FLAKY', 'BAD')])
    monkeypatch.setattr(s, 'FUND_RETRY_DELAYS', [0, 0])
    monkeypatch.setattr(s, 'HISTORY_DIR', str(tmp_path))
    monkeypatch.setattr(s, 'DASHBOARD_CSV', str(out_csv))
    monkeypatch.setattr(s, 'RAW_DIR', str(tmp_path / 'raw'))
    monkeypatch.setattr(s, 'fetch_fund', fake_fetch)
    monkeypatch.setattr(s, 'enrich_with_analytics', lambda df: df)
    monkeypatch.setattr(s, 'setup_database', lambda: None)
    monkeypatch.setattr(s, 'CusipLookup', lambda: type('C', (), {'stats': lambda self: {'cached_mappings': 0}})())
    monkeypatch.setattr(s, 'save_to_db', lambda df: None)
    monkeypatch.setattr(s, 'generate_changes_sql', lambda today: None)
    monkeypatch.setattr(s, 'cleanup_old_records', lambda: None)
    monkeypatch.setattr(s, 'log', lambda *_: None)
    monkeypatch.setattr(s.time, 'sleep', lambda *_: None)

    s.main()

    out = pd.read_csv(out_csv, dtype=str)
    by_fund = {f: g for f, g in out.groupby('ETF Ticker')}
    assert set(by_fund) == {'OK', 'OK2', 'OK3', 'FLAKY', 'BAD'}
    assert calls == {'OK': 1, 'OK2': 1, 'OK3': 1, 'FLAKY': 2, 'BAD': 3}  # first sweep + 2 retry passes
    assert by_fund['FLAKY']['Refreshed'].tolist() == ['True']
    assert by_fund['BAD']['Refreshed'].tolist() == ['False']
    assert by_fund['BAD']['Source_Date'].tolist() == ['2026-09-22']
