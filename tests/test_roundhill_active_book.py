"""
Tests for the Roundhill active-fund normalisation (DRAM, CHAT).

DRAM holds ~40% of its book as total-return swaps on companies it also holds
directly. The API hides every ' TRS ' row as junk, so unless the scraper folds
each swap into its underlying, Micron (~26% of the fund) reads as its 0.4%
direct line. These tests use rows lifted from the real 2026-09-24 bulk CSV.
"""

import os
import sys

import pandas as pd

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scrape_avantis import (
    FUNDS,
    _prepare_roundhill_active_book,
    _roundhill_local_ticker,
    _swap_underlying_key,
)
from api.data import get_fund_category, is_institutional_fund


def _dram():
    rows = [
        # ticker, name, shares, market value, weight
        ("000660 KS", "SK hynix Inc", 3343014, 5_887_000_000, "16.82%"),
        ("005930 KS", "Samsung Electronics Co Ltd", 25005289, 5_257_000_000, "19.29%"),
        ("005935 KS", "Samsung Electronics Co Ltd", 190664, 30_885_860, "0.11%"),
        ("2344 TT", "Winbond Electronics Corp", 53647790, 292_047_100, "1.07%"),
        ("603986 C1", "GigaDevice Semiconductor Inc", 4689160, 278_777_300, "1.02%"),
        ("MU", "Micron Technology Inc", 102076, 109_420_000, "0.40%"),
        ("595112103 TRS 050427 NM", "MICRON TECHNOLOGY INC SWAP NM", 4052306, 4_343_000_000, "15.94%"),
        ("595112103 TRS 052427 GS", "MICRON TECHNOLOGY, INC.-SWAP-GOL", 2407575, 2_581_000_000, "9.47%"),
        ("6450267 TRS 052427 GS", "SK HYNIX INC-SWAP-GOLD-L", 1068542, 1_466_000_000, "5.38%"),
        ("6771720 TRS 052427 GS", "SAMSUNG ELECTRONICS -SWAP-GOLD-L", 7886239, 1_658_000_000, "6.08%"),
        ("BTMTQT8 TRS 052427 GS", "CXMT CORPORATION-SWAP-GOLD-L", 163643478, 1_430_000_000, "5.25%"),
        ("KRW", "SOUTH KOREA WON", 19168598088, 13_000_000, "0.05%"),
        ("CNY", "CHINESE YUAN", -477736, -66_000, "0.00%"),
        ("Cash&Other", "Cash & Other", -1e10, -1e10, "-37.26%"),
    ]
    return pd.DataFrame(
        [dict(Account="DRAM", StockTicker=t, SecurityName=n, Shares=s,
              MarketValue=mv, Weightings=w, Price=1.0) for t, n, s, mv, w in rows]
    )


def test_swaps_fold_into_the_direct_row_for_the_same_company():
    out = _prepare_roundhill_active_book(_dram()).set_index("StockTicker")
    mu = out.loc["MU"]
    assert mu["Shares"] == 102076 + 4052306 + 2407575
    assert mu["MarketValue"] == 109_420_000 + 4_343_000_000 + 2_581_000_000
    assert float(mu["Weightings"].rstrip("%")) == 25.81
    assert mu["SecurityName"] == "Micron Technology Inc"  # direct row's name wins


def test_no_swap_rows_survive():
    out = _prepare_roundhill_active_book(_dram())
    assert not out["StockTicker"].str.contains("TRS").any()
    assert not out["SecurityName"].str.upper().str.contains("SWAP").any()


def test_korean_codes_follow_the_avantis_convention():
    out = _prepare_roundhill_active_book(_dram()).set_index("StockTicker")
    # 000660 KS / 005930 KS -> A000660 / A005930, matching AVEM and CGXU
    assert "A000660" in out.index and "A005930" in out.index
    # The swap folded into the *common* share line, not the 005935 preferred.
    assert out.loc["A005930", "Shares"] == 25005289 + 7886239
    assert out.loc["A005935", "Shares"] == 190664


def test_swap_with_no_direct_row_keeps_its_own_named_ticker():
    out = _prepare_roundhill_active_book(_dram()).set_index("StockTicker")
    assert out.loc["CXMT", "SecurityName"] == "CXMT CORPORATION"
    assert out.loc["CXMT", "Shares"] == 163643478


def test_fx_cash_rows_are_dropped_but_cash_and_other_is_kept():
    out = _prepare_roundhill_active_book(_dram())
    assert not {"KRW", "CNY"} & set(out["StockTicker"])
    assert "Cash&Other" in set(out["StockTicker"])  # the API's junk filter owns this one


def test_exchange_suffixes_are_stripped():
    out = _prepare_roundhill_active_book(_dram())
    assert {"2344", "603986"} <= set(out["StockTicker"])


def test_consolidation_is_idempotent_and_keeps_one_row_per_ticker():
    once = _prepare_roundhill_active_book(_dram())
    assert once["StockTicker"].is_unique
    twice = _prepare_roundhill_active_book(once.copy())
    assert len(twice) == len(once)


def test_local_ticker_mapping():
    assert _roundhill_local_ticker("000660 KS") == "A000660"
    assert _roundhill_local_ticker("2330 TT") == "2330"
    assert _roundhill_local_ticker("603986 C1") == "603986"
    assert _roundhill_local_ticker("MU") == "MU"
    assert _roundhill_local_ticker("285A JP") == "285A JP"  # main()'s shared strip owns JP


def test_underlying_key_matches_swap_and_direct_names():
    assert (_swap_underlying_key("MICRON TECHNOLOGY, INC.-SWAP-GOL")
            == _swap_underlying_key("Micron Technology Inc") == "MICRON TECHNOLOGY")
    assert _swap_underlying_key("SK HYNIX INC-SWAP-GOLD-L") == _swap_underlying_key("SK hynix Inc")


# ─── Config + classification wiring ──────────────────────────────────────────

def test_only_the_active_funds_opt_in():
    """WeeklyPay funds must NOT be folded retroactively — that would read as a
    phantom multi-hundred-percent buy on the first day."""
    opted = {f["ticker"] for f in FUNDS if f.get("active_book")}
    assert opted == {"DRAM", "CHAT"}


def test_dram_and_chat_are_active_equity_despite_the_roundhill_provider():
    for fund in ("DRAM", "CHAT"):
        assert get_fund_category(fund) == "active-equity"
        assert is_institutional_fund(fund)
    # ...and the override is per-fund: the rest of Roundhill stays income.
    for fund in ("QDTE", "NVDW", "YBTC"):
        assert get_fund_category(fund) == "option-income"
