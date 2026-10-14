"""The 27 YieldMax funds added 2026-10-14 must be wired into every registry."""
import re
from pathlib import Path

import pytest

import scrape_avantis
from api.data import FUND_PROVIDERS, get_fund_category

NEW = "AIYY BABO BIGY CRSH CVNY DIPS FBY FIAT GMEY GPTY LFGY MARO MRNY MSFO NFLY OARK PYPY RDTY RNTY SDTY SMCY SNOY SOXY TSMY WNTR XOMO YQQQ".split()
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
