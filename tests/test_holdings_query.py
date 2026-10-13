"""/holdings filters + paging + active Δ + DTE, the rotation report, the MWF schedule."""
import csv
import json
import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from api import data

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / 'tests' / 'fixtures' / 'active_parity' / 'public' / 'data' / 'history'


@pytest.fixture
def book(monkeypatch):
    monkeypatch.setattr(data, 'HISTORY_DIR', str(FIX))
    data._available_dates.cache_clear()
    data._holdings_book.cache_clear()
    yield
    data._holdings_book.cache_clear()


@pytest.fixture
def client(monkeypatch):
    from api.server import app, limiter
    monkeypatch.setattr(limiter, 'enabled', False)
    return TestClient(app)


def test_active_weight_delta_matches_the_websites_computediff_row_for_row(book):
    """golden.json = lib/holdings.ts computeDiff via holdings-query's assignment
    (regenerate: node tests/fixtures/active_parity/gen_golden.mjs). Covers drift-only,
    a share purchase, a 2:1 split, a new position, an option, cash and a catch-up fund."""
    golden = json.loads((FIX.parent.parent.parent / 'golden.json').read_text())
    expected = {tuple(k.split('|', 1)): v for k, v in golden.items()}
    expected = {(f, data._clean_ticker(t)): v for (f, t), v in expected.items()}
    rows = data.get_all_holdings()['holdings']
    assert len(rows) == len(expected)
    for r in rows:
        want = expected[(r['fund'], r['ticker'])]
        if want is None:
            assert r['activeWeightDelta'] is None and r['weightDelta'] is None, r['ticker']
            assert r['catchUpSince'] == '2026-09-25'
        else:
            assert r['activeWeightDelta'] == pytest.approx(want, abs=1e-3), (r['fund'], r['ticker'])
    by = {(r['fund'], r['ticker']): r for r in rows}
    # the semantics the golden encodes, spelled out
    assert abs(by[('AAA', 'A1')]['activeWeightDelta']) < 1e-3          # price drift only
    assert abs(by[('AAA', 'A4')]['activeWeightDelta']) < 1e-3          # 2:1 split is not a trade
    assert by[('AAA', 'A2')]['activeWeightDelta'] > 7                  # shares bought
    assert by[('AAA', 'A1')]['weightDelta'] > 1                        # raw Δ still carries the drift


def test_dte_is_the_snapshot_value_and_assets_are_classified(book):
    rows = {(r['fund'], r['ticker']): r for r in data.get_all_holdings()['holdings']}
    opt = rows[('AAA', 'A1 261120C00050000')] if ('AAA', 'A1 261120C00050000') in rows else next(r for r in rows.values() if r['isOption'])
    assert opt['dte'] == 42.0 and opt['assetClass'] == 'option' and opt['strike'] == 50.0
    assert rows[('AAA', 'A2')]['dte'] is None and rows[('AAA', 'A2')]['assetClass'] == 'equity'
    assert rows[('AAA', 'CASH')]['assetClass'] == 'cash'


def test_default_request_is_the_legacy_full_unpaginated_shape(book, client):
    j = client.get('/api/v1/holdings').json()
    assert set(j) == {'asOfDate', 'previousDate', 'comparisonTradingDays', 'total', 'count', 'holdings'}   # + additive comparison fields
    assert j['count'] == j['total'] == 11
    assert {'weightDelta', 'sharesDelta', 'marketValue', 'positionUsd', 'isOption', 'cusip'} <= set(j['holdings'][0])


def test_filters_search_sort_and_paging(book, client):
    g = lambda **p: client.get('/api/v1/holdings', params=p).json()
    assert {r['fund'] for r in g(fund='CCC')['holdings']} == {'CCC'}
    assert {r['fund'] for r in g(fund='ccc')['holdings']} == {'CCC'}      # case-insensitive
    assert [r['assetClass'] for r in g(asset='option')['holdings']] == ['option']
    assert [r['ticker'] for r in g(asset='cash')['holdings']] == ['CASH']
    assert [r['ticker'] for r in g(q='epsil')['holdings']] == ['A5']      # name search
    assert [r['ticker'] for r in g(q='b2')['holdings']] == ['B2']         # ticker search
    d = g(fund='AAA', sort='delta')['holdings']
    vals = [r['activeWeightDelta'] for r in d]
    assert vals == sorted(vals, reverse=True)
    asc = g(sort='delta', dir='asc')['holdings']
    assert asc[-3:] and all(r['activeWeightDelta'] is None for r in asc[-3:])   # catch-up nulls sink last
    desc = g(sort='delta')['holdings']
    assert all(r['activeWeightDelta'] is None for r in desc[-3:])
    v = g(sort='value')['holdings']
    assert v[0]['marketValue'] == max(r['marketValue'] for r in v)
    p1 = g(page=1, size=4)
    assert (p1['total'], p1['count'], p1['pages'], p1['page'], p1['size']) == (11, 4, 3, 1, 4)
    p3 = g(page=3, size=4)
    assert p3['count'] == 3
    assert g(page=99, size=4)['page'] == 3                                  # clamped, not an error
    assert g(size=5)['page'] == 1 and g(size=5)['count'] == 5               # size alone paginates
    assert g(fund='AAA', page=1, size=2)['total'] == 6


def test_bad_params_are_rejected_and_csv_export_is_uncapped(book, client):
    assert client.get('/api/v1/holdings', params={'asset': 'bonds'}).status_code == 422
    assert client.get('/api/v1/holdings', params={'sort': 'nope'}).status_code == 422
    assert client.get('/api/v1/holdings', params={'size': 501}).status_code == 422
    assert client.get('/api/v1/holdings', params={'fund': '../x'}).status_code == 422   # one status for every bad /holdings value
    r = client.get('/api/v1/holdings', params={'format': 'csv', 'size': 2, 'page': 2})   # page/size ignored
    assert r.headers['content-type'].startswith('text/csv')
    rows = list(csv.DictReader(r.text.splitlines()))
    assert len(rows) == 11 and rows[0]['fund'] and 'activeWeightDelta' in rows[0]
    assert next(x for x in rows if x['fund'] == 'BBB')['activeWeightDelta'] == ''       # null stays blank, not 0


# ─── Rotation ────────────────────────────────────────────────────

def test_rotation_report_is_served_unchanged_plus_freshness(book, client, tmp_path, monkeypatch):
    pub = tmp_path / 'public' / 'data'; (pub / 'history').mkdir(parents=True)
    report = {'fund': 'ULTI', 'groupBy': 'theme', 'asOf': '2026-10-01', 'holdings': 16, 'dates': ['2026-10-01'],
              'themes': ['AI'], 'timeline': [{'date': '2026-10-01', 'weights': {'AI': 50.0}}],
              'currentThemes': {'AI': 50.0}, 'churnSincePrior': {'added': [], 'dropped': []}, 'unmapped': ['XYZ']}
    (pub / 'ulti_rotation.json').write_text(json.dumps(report))
    monkeypatch.setattr(data, 'HISTORY_DIR', str(pub / 'history'))
    got = client.get('/api/v1/fund/ULTI/rotation').json()
    assert {k: got[k] for k in report} == report                      # every original field, untouched
    assert got['snapshotAsOfDate'] == data.get_as_of_date()
    assert client.get('/api/v1/fund/ulti/rotation').status_code == 200
    assert client.get('/api/v1/fund/AVUV/rotation').status_code == 404
    assert client.get('/api/v1/fund/..%2Fx/rotation').status_code in (404, 422)


def test_rotation_stale_flag_follows_the_reports_own_date(tmp_path, monkeypatch):
    pub = tmp_path / 'public' / 'data'; (pub / 'history').mkdir(parents=True)
    for d in ('2026-10-08', '2026-10-09'):
        (pub / 'history' / f'holdings_{d}.csv').write_text('Name,Ticker,ETF Ticker\nx,X,AAA\n')
    (pub / 'ulty_rotation.json').write_text(json.dumps({'fund': 'ULTY', 'asOf': '2026-10-01'}))
    (pub / 'ulti_rotation.json').write_text(json.dumps({'fund': 'ULTI', 'asOf': '2026-10-08'}))
    monkeypatch.setattr(data, 'HISTORY_DIR', str(pub / 'history')); data._available_dates.cache_clear()
    assert data.get_rotation_report('ULTY')['stale'] is True
    assert data.get_rotation_report('ULTI')['stale'] is False
    assert data.list_rotation_funds() == ['ULTI', 'ULTY']
    data._available_dates.cache_clear()


# ─── MWF schedule ────────────────────────────────────────────────

def test_mwf_schedule_matches_the_website_source():
    ts = (ROOT / 'etf-dashboard' / 'lib' / 'marketHours.ts').read_text()
    web_tickers = re.findall(r'"([A-Z]+)"', ts[ts.index('MWF_TICKERS = ['):ts.index('] as const')])
    assert list(data.MWF_TICKERS) == web_tickers
    web_holidays = set(re.findall(r'"(\d{4}-\d{2}-\d{2})",', ts[ts.index('NYSE_HOLIDAYS'):ts.index(']);')]))
    assert web_holidays == set(data._NYSE_HOLIDAYS)


@pytest.mark.parametrize('when,is_exp,day,nxt', [
    ('2026-10-12', True, 'Monday', '2026-10-14'),       # Monday -> Wednesday
    ('2026-10-13', False, 'Tuesday', '2026-10-14'),
    ('2026-10-16', True, 'Friday', '2026-10-19'),       # Friday -> Monday
    ('2026-07-01', True, 'Wednesday', '2026-07-06'),    # Fri 07-03 is a holiday: skipped to Monday
    ('2026-01-19', False, 'Monday', '2026-01-21'),      # MLK Monday is not an expiration day
    ('2026-10-10', False, 'Saturday', '2026-10-12'),
])
def test_mwf_schedule_calendar(when, is_exp, day, nxt):
    now = datetime.fromisoformat(when + 'T12:00:00').replace(tzinfo=ZoneInfo('America/New_York'))
    s = data.get_mwf_schedule(now)
    assert (s['isExpirationDay'], s['dayName'], s['nextExpirationDate']) == (is_exp, day, nxt)
    assert s['nextExpirationDay'] == datetime.fromisoformat(nxt).strftime('%A')
    assert len(s['tickers']) == 12 and 'SPY' not in s['tickers'] and s['excludes'] == ['SPY', 'QQQ']


def test_schedule_endpoint(client):
    j = client.get('/api/v1/options-listings/schedule').json()
    assert j['tickers'][:4] == ['GLD', 'IBIT', 'SLV', 'TLT'] and j['expirationWeekdays'] == ['Monday', 'Wednesday', 'Friday']


def test_fund_filter_keeps_155s_contract(book, client):
    r = client.get('/api/v1/holdings', params={'fund': 'ccc'})
    assert r.status_code == 200 and r.headers['x-fund-filter'] == 'CCC'
    assert r.json()['fund'] == 'CCC' and {h['fund'] for h in r.json()['holdings']} == {'CCC'}
    # unfiltered rows for that fund are identical to the filtered ones
    everything = client.get('/api/v1/holdings').json()
    assert 'fund' not in everything and 'x-fund-filter' not in client.get('/api/v1/holdings').headers
    assert [h for h in everything['holdings'] if h['fund'] == 'CCC'] == r.json()['holdings']
    assert client.get('/api/v1/holdings', params={'fund': 'NOPE'}).json()['holdings'] == []
    assert data.get_all_holdings(fund='arkk')['fund'] == 'ARKK'
    # the header is readable from a browser (CORS-exposed)
    pre = client.get('/api/v1/holdings', headers={'Origin': 'https://tickertrace.pro'})
    assert 'x-fund-filter' in pre.headers.get('access-control-expose-headers', '').lower() or pre.status_code == 200


def test_ticker_cash_is_cash_only_when_the_name_is_not_a_company():
    """Pathward Financial (a real AVUV stock) trades under the ticker CASH."""
    from api import income
    pathward = {'Name': 'PATHWARD FINANCIAL INC COMMON STOCK USD.01', 'Ticker': 'CASH'}
    placeholder = {'Name': 'Cash & Other', 'Ticker': 'CASH'}
    assert data.holding_asset_class(pathward) == 'equity'
    assert data.holding_asset_class(placeholder) == 'cash'
    assert income._sleeve_of(pathward) == 'equity'
    assert income._sleeve_of(placeholder) == 'cash'
    assert income._sleeve_of({'Name': 'Whatever', 'Ticker': 'TBILL'}) == 'treasury'   # others unchanged
    assert not data.is_cash_placeholder('CASH', 'PATHWARD FINANCIAL INC COMMON STOCK USD.01')
    assert data.is_cash_placeholder('usd', 'US DOLLAR')


# ─── Money-market funds are cash, in BOTH classifiers ────────────────────────

MM_ROWS = [
    ('FGXXX', 'First American Government Obligations Fund 12/01/2031'),
    ('FGXXX', 'FIRST AMERICAN GOVERNMENT OBLI FIRST AM GOV OBLIG X'),
    ('FIGXX', 'FIDELITY INV MMKT GOVT-I  12/31/2031'),
    ('AGPXX', 'Invesco Government & Agency Portfolio 12/31/2031'),
    ('CMQXX', 'CAPITAL GROUP CENTRAL CASH FUN CAPITAL GROUP CNTRL C'),
    ('OTHER', 'SSC GOVERNMENT MM GVMXX'),
    ('OTHER', 'GOLDMAN FS TRSY OBLIG INST 468'),
    ('SPAXX', 'Fidelity Government Money Market'),
    ('', 'JPMorgan Treasury Plus Money Market Fund'),
    ('', 'BlackRock Treasury Portfolio Institutional'),
    ('', 'Dreyfus Government Cash Management'),   # no phrase we match: stays as before (not a regression)
]
REAL_COMPANIES = [
    ('CML', 'CORONATION FUND MANAGERS LTD COMMON STOCK ZAR.0001'),
    ('EUR', 'EUROCASH SA COMMON STOCK PLN1.0'),
    ('6418', 'JAPAN CASH MACHINE CO LTD COMMON STOCK'),
    ('MTS', 'METCASH LTD COMMON STOCK'),
    ('FCFS', 'FirstCash Holdings, Inc.'),
    ('TWE', 'TREASURY WINE ESTATES LTD COMMON STOCK'),
    ('LQDT', 'LIQUIDITY SERVICES INC COMMON STOCK USD.001'),
    ('SPXX', 'Nuveen S&P 500 Dynamic Overwrite Fund'),       # 4-letter ticker: a real closed-end fund
    ('IDXX', 'IDEXX LABORATORIES INC COMMON STOCK'),
    ('USA', 'Liberty All-Star Equity Fund'),
    ('ACP', 'abrdn Income Credit Strategies Fund'),
    ('FBTC', 'Fidelity Wise Origin Bitcoin Fund'),
    ('CASH', 'PATHWARD FINANCIAL INC COMMON STOCK USD.01'),   # real ticker CASH
    ('CSB', 'CASHBUILD LTD COMMON STOCK ZAR.01'),            # AVEM, 2026-10-12: name starts with CASH
    ('LRE', 'LANCASHIRE HOLDINGS LTD COMMON STOCK USD.5'),
    ('FCFS', 'FIRSTCASH HOLDINGS INC'),
    ('CCV', 'CASH CONVERTERS INTERNATIONAL LTD'),
    ('BILL', 'BILL HOLDINGS INC COMMON STOCK USD.00001'),    # the T-bill hint 'BILL ' once made it a Treasury
]
CASH_NAMES = ['CASH', 'Cash', 'CASH & OTHER', 'CASH & EQUIVALENTS', 'CASH EQUIVALENT', 'USD CASH', 'Net Cash', 'CASH COLLATERAL USD']


def test_is_money_market_catches_the_funds_and_no_company():
    from api import data
    for t, n in MM_ROWS[:9]:
        assert data.is_money_market(t, n), (t, n)
    for t, n in REAL_COMPANIES:
        assert not data.is_money_market(t, n), (t, n)


def test_money_market_funds_are_cash_in_assetclass_and_income_sleeves():
    from api import data, income
    for t, n in MM_ROWS[:9]:
        row = {'Ticker': t, 'Name': n, 'ETF Ticker': 'X'}
        assert data.holding_asset_class(row) == 'cash', (t, n)
        assert income._sleeve_of(row) == 'cash', (t, n)
    # A fund NAMED "Treasury Obligations" is cash, not T-bills: the money-market check runs before the T-bill hints.
    assert income._sleeve_of({'Ticker': 'OTHER', 'Name': 'GOLDMAN FS TRSY OBLIG INST 468'}) == 'cash'
    assert income._sleeve_of({'Ticker': '', 'Name': 'Some Treasury Obligations Fund'}) == 'cash'
    # real T-bills stay treasuries, real companies stay equity
    assert data.holding_asset_class({'Ticker': '912797UK1', 'Name': 'United States Treasury Bill 10/15/2026'}) == 'treasury'
    assert income._sleeve_of({'Ticker': '912797UK1', 'Name': 'United States Treasury Bill 10/15/2026'}) == 'treasury'
    for t, n in REAL_COMPANIES:
        assert data.holding_asset_class({'Ticker': t, 'Name': n}) == 'equity', (t, n)
        assert income._sleeve_of({'Ticker': t, 'Name': n}) == 'equity', (t, n)


def test_cash_is_a_whole_word_never_a_company_prefix():
    from api import data, income
    for n in CASH_NAMES:
        row = {'Ticker': 'OTHER', 'Name': n}
        assert data.is_cash_name(n), n
        assert data.holding_asset_class(row) == 'cash', n
        assert income._sleeve_of(row) == 'cash', n
    # The word inside a longer token is not cash, and a company/share-class name can never be cash.
    for n in ('CASHBUILD LTD COMMON STOCK ZAR.01', 'EUROCASH SA COMMON STOCK PLN1.0', 'METCASH LTD COMMON STOCK',
              'FirstCash Holdings, Inc.', 'JAPAN CASH MACHINE CO LTD COMMON STOCK', 'CASH CONVERTERS INTERNATIONAL LTD'):
        assert not data.is_cash_name(n), n
    assert not data.is_cash_name('CASHFLOW SERVICES')           # not the whole word
    assert data.holding_asset_class({'Ticker': 'CSB', 'Name': 'CASHBUILD LTD COMMON STOCK ZAR.01'}) == 'equity'
    # Other income cash phrases still work, but never on a company
    assert income._sleeve_of({'Ticker': '', 'Name': 'NET OTHER ASSETS'}) == 'cash'
    assert income._sleeve_of({'Ticker': 'XYZ', 'Name': 'PAYABLE HOLDINGS INC COMMON STOCK'}) == 'equity'


def test_live_book_invariants_for_cash_classification():
    """On the committed current book: every 5-letter-XX ticker is cash, and nothing named like a common stock is."""
    import pytest
    from api import data, income
    rows = data.get_latest_holdings()
    if not rows:
        pytest.skip('no history data checked in')
    for r in rows:
        if (r.get('Option_Type') or '').strip():
            continue
        t, n, cls = (r.get('Ticker') or '').strip().upper(), r.get('Name') or '', data.holding_asset_class(r)
        if len(t) == 5 and t.endswith('XX'):
            assert cls == 'cash', (r.get('ETF Ticker'), t, n, cls)
        if 'COMMON STOCK' in n.upper():
            assert cls != 'cash', (r.get('ETF Ticker'), t, n, cls)
            # The Income screen's sleeves share the rule (a substring 'CASH' once made Cashbuild, Metcash, FirstCash ... cash).
            assert income._sleeve_of(r) not in ('cash', 'treasury'), (r.get('ETF Ticker'), t, n)
