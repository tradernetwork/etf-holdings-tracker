"""The date every delta is measured against is exposed (previousDate, comparisonTradingDays), using the diff's own choice."""
from fastapi.testclient import TestClient

from api import data


def _dates(monkeypatch, dates):
    monkeypatch.setattr(data, 'get_available_dates', lambda: list(dates))


def test_daily_comparison_is_the_previous_snapshot_file(monkeypatch):
    _dates(monkeypatch, ['2026-10-12', '2026-10-09', '2026-10-08'])
    assert data.comparison_date('daily') == '2026-10-09'
    # the diff reads dates[1]: same choice
    seen = []
    monkeypatch.setattr(data, '_read_csv', lambda path: seen.append(path) or [])
    data.get_previous_holdings()
    assert seen[0].endswith('holdings_2026-10-09.csv')


def test_weekly_and_monthly_use_the_lookback_the_diff_uses(monkeypatch):
    dates = ['2026-10-12', '2026-10-09', '2026-10-08', '2026-10-05', '2026-10-02', '2026-09-29', '2026-09-11', '2026-09-10']
    _dates(monkeypatch, dates)
    assert data.comparison_date('weekly') == '2026-10-05'      # newest file on/before Oct 12 - 7d
    assert data.comparison_date('monthly') == '2026-09-11'     # newest on/before Sep 12
    seen = []
    monkeypatch.setattr(data, '_read_csv', lambda path: seen.append(path) or [])
    data._snapshot_for_lookback(7)
    data._snapshot_for_lookback(30)
    assert [p.rsplit('_', 1)[1] for p in seen] == ['2026-10-05.csv', '2026-09-11.csv']


def test_not_enough_history_means_no_previous_date(monkeypatch):
    _dates(monkeypatch, ['2026-10-12'])
    assert data.comparison_date('daily') is None
    assert data.comparison_date('weekly') is None
    assert data.comparison_info('daily', '2026-10-12') == {'previousDate': None, 'comparisonTradingDays': None}


def test_trading_days_count_holidays_and_missed_scrapes():
    assert data.trading_days_between('2026-10-08', '2026-10-09') == 1      # consecutive sessions
    assert data.trading_days_between('2026-10-09', '2026-10-12') == 1      # over the weekend
    assert data.trading_days_between('2026-10-07', '2026-10-09') == 2      # Oct 8 scrape missed: two sessions
    assert data.trading_days_between('2026-09-04', '2026-09-08') == 1      # over Labor Day (Sep 7): one session
    assert data.trading_days_between('2026-09-03', '2026-09-08') == 2      # Fri Sep 4 + Tue Sep 8
    assert data.trading_days_between(None, '2026-10-09') is None
    assert data.trading_days_between('2026-10-09', '2026-10-09') is None   # no span


def test_endpoints_carry_the_comparison_on_real_data():
    dates = data.get_available_dates()
    if len(dates) < 2:
        return
    c = TestClient(__import__('api.server', fromlist=['app']).app)
    fund = next(f for f in ('MSTY', 'ARKK', 'AVUV') if c.get(f'/api/v1/fund/{f}').status_code == 200)
    for url in (f'/api/v1/fund/{fund}', '/api/v1/changes?limit=1', '/api/v1/holdings?page=1&size=1', '/api/v1/signals?limit=1'):
        j = c.get(url).json()
        assert j['previousDate'] == dates[1], url
        assert j['comparisonTradingDays'] == data.trading_days_between(dates[1], dates[0]), url
    assert c.get('/api/v1/changes?period=weekly&limit=1').json()['previousDate'] == data.comparison_date('weekly')
    assert c.get('/api/v1/changes?period=monthly&page=1&size=1').json()['previousDate'] == data.comparison_date('monthly')
    t = c.get('/api/v1/ticker/MSTR')
    if t.status_code == 200:
        assert t.json()['previousDate'] == dates[1]
        assert t.json()['asOfDate'] == dates[0]


def test_openapi_documents_the_comparison_fields():
    from api.server import app
    schema = app.openapi()
    for path in ('/api/v1/fund/{fund}', '/api/v1/ticker/{ticker}', '/api/v1/changes', '/api/v1/holdings', '/api/v1/signals'):
        props = schema['paths'][path]['get']['responses']['200']['content']['application/json']['schema']['properties']
        assert 'previousDate' in props and 'comparisonTradingDays' in props, path
