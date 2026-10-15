"""The 25 YieldMax funds added 2026-10-14 must be wired into every registry."""
import re
from pathlib import Path

import pytest

import scrape_avantis
from api.data import FUND_PROVIDERS, get_fund_category

NEW = "AIYY BABO BIGY CRSH CVNY DIPS FBY FIAT GPTY LFGY MARO MRNY MSFO NFLY OARK PYPY RDTY SDTY SMCY SNOY SOXY TSMY WNTR XOMO YQQQ MSST".split()
PROVIDERS_TS = Path(__file__).resolve().parent.parent / "etf-dashboard" / "lib" / "providers.ts"


@pytest.mark.parametrize("fund", NEW)
def test_new_yieldmax_fund_is_registered_everywhere(fund):
    cfg = [f for f in scrape_avantis.FUNDS if f["ticker"] == fund]
    assert len(cfg) == 1, "exactly one scraper entry"
    assert cfg[0]["url"].endswith(f"/{fund}/TidalFG_Holdings_{fund}.csv")
    assert FUND_PROVIDERS[fund] == "YieldMax"
    assert get_fund_category(fund) == "option-income"
    assert re.search(rf"\b{fund}: 'YieldMax'", PROVIDERS_TS.read_text(encoding="utf-8"))


def test_no_duplicate_scraper_tickers():
    tickers = [f["ticker"] for f in scrape_avantis.FUNDS]
    assert len(tickers) == len(set(tickers))


def test_clean_numeric_text_handles_neos_formatting():
    import pandas as pd
    df = pd.DataFrame({"Price": ["$341.27", "$0.00"], "NetAssets": ['$12,632,124,288.00'] * 2,
                       "SharesOutstanding": ["233,520,000"] * 2, "Ticker": ["A", "B"]})
    out = scrape_avantis.clean_numeric_text(df)
    assert out["Price"].tolist() == [341.27, 0.0]
    assert out["NetAssets"].iloc[0] == 12632124288.0
    assert out["SharesOutstanding"].iloc[0] == 233520000
    assert out["Ticker"].tolist() == ["A", "B"]


def test_clean_numeric_text_leaves_numeric_columns_alone():
    import pandas as pd
    df = pd.DataFrame({"Price": [1.5, 2.5]})
    assert scrape_avantis.clean_numeric_text(df)["Price"].tolist() == [1.5, 2.5]


@pytest.mark.parametrize("fund,provider", [
    ("YMAG", "YieldMax"), ("AMDW", "Roundhill"), ("TOPW", "Roundhill"), ("XPAY", "Roundhill"),
    ("WEEK", "Roundhill"), ("FEPI", "REX Shares"), ("AIPI", "REX Shares"), ("CEPI", "REX Shares"),
    ("SPYI", "Neos"), ("QQQI", "Neos"), ("IWMI", "Neos"), ("BTCI", "Neos"), ("CSHI", "Neos"), ("IAUI", "Neos"),
])
def test_second_wave_funds_are_registered(fund, provider):
    assert sum(f["ticker"] == fund for f in scrape_avantis.FUNDS) == 1
    assert FUND_PROVIDERS[fund] == provider
    assert get_fund_category(fund) == "option-income"
    assert re.search(rf"\b{fund}: '{provider}'", PROVIDERS_TS.read_text(encoding="utf-8"))
