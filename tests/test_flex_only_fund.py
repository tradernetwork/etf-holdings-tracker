"""A FLEX-only fund whose remaining book is T-bills + cash must still list its whole book."""
import pytest
from api import data


def r(ticker, name, weight, **extra):
    return {'ETF Ticker': 'TSLP', 'Ticker': ticker, 'Name': name, 'Weight': str(weight),
            'Share Quantity': '10', 'Market Value': '1000', 'Sector': '', 'Option_Type': '',
            'NetAssets': '16955385', **extra}


@pytest.fixture
def book(monkeypatch):
    rows = [
        r('2TSLA 261218C00350000', 'TSLA 12/18/2026 350 C', 9.7, Option_Type='Call',
          Underlying_Ticker='TSLA', Option_Strike='350', Option_Expiry='2026-12-18', Is_Flex='True'),
        r('912797TC1', 'United States Treasury Bill 12/24/2026', 35.1),
        r('912797UD7', 'United States Treasury Bill 03/25/2027', 35.3),
        r('FIGXX', 'FIDELITY INV MMKT GOVT-I', 0.86),
        r('Cash&Other', 'Cash & Other', 0.04),
    ]
    monkeypatch.setattr(data, 'get_latest_holdings', lambda: rows)
    monkeypatch.setattr(data, 'get_previous_holdings', lambda: [])
    monkeypatch.setattr(data, 'get_as_of_date', lambda: '2026-10-15')
    monkeypatch.setattr(data, '_compute_streaks', lambda: {})
    data._fund_aum_map.cache_clear()
    yield rows
    data._fund_aum_map.cache_clear()


def test_fund_detail_counts_the_whole_non_option_book(book):
    d = data.get_fund_detail('TSLP')
    assert d['holdingsCount'] == 4
    assert d['optionsCount'] == 1
    assert d['topHoldings'] == []
    assert {o['assetClass'] for o in d['otherHoldings']} == {'treasury', 'cash'}
    assert d['totalWeight'] == pytest.approx(71.3)


def test_funds_index_does_not_report_zero_holdings(book):
    f = [x for x in data.get_funds_index() if x['fund'] == 'TSLP'][0]
    assert f['holdingsCount'] == 4
    assert f['topHolding'] is None
