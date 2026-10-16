"""
Tests for the single fund-category classifier (api/data.py).

Context: this codebase used to carry FIVE competing definitions of "income
fund" that disagreed with each other:

  1. lib/providers.ts    OPTION_INCOME_PROVIDERS   (6 providers, zero call sites)
  2. api/data.py         _OPTION_INCOME_PROVIDERS  (6 providers, label only)
  3. api/data.py         _INCOME_ONLY_PROVIDERS    (4 providers, drove every filter)
  4. effectiveness.py    OPTION_FUNDS              (9 hardcoded tickers)
  5. rotation-panel.tsx  ROTATION_FUNDS            ({ULTI, ULTY})

The 2-vs-3 gap meant BLOX and the EGG* funds were labelled 'option-income' in
the UI while being counted as institutional stock-pickers in the signal math.
These tests pin the reconciled behaviour so it can't split again.
"""

import csv
import glob
import os

import pytest

from api.data import (
    FUND_PROVIDERS,
    get_fund_category,
    is_institutional_fund,
)
import effectiveness

HISTORY_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "etf-dashboard", "public", "data", "history",
)


# ─── The basic contract ──────────────────────────────────────────────────────

@pytest.mark.parametrize("fund", ["ARKK", "ARKG", "AVUV", "AVLV", "AVMV", "GBUG", "BLOK", "HACK"])
def test_stock_pickers_are_active_equity(fund):
    assert get_fund_category(fund) == "active-equity"


@pytest.mark.parametrize("fund", [
    "ULTY", "KYLD", "KQQQ", "ULTI", "MSTY", "NVDY", "QDTE", "XDTE",
    "BLOX", "EGGQ", "EGGY", "EGGS",
])
def test_option_income_funds_are_option_income(fund):
    assert get_fund_category(fund) == "option-income"


@pytest.mark.parametrize("fund", ["DIVO", "QDVO", "IDVO"])
def test_amplify_overlay_funds_are_option_income(fund):
    """Amplify ships both product lines, so the provider alone can't decide.

    Before the per-fund override these three were classified 'active-equity',
    and DIVO drove the #1 sell signal on the dashboard as a "stock picker".
    """
    assert get_fund_category(fund) == "option-income"


def test_yyy_is_income_not_active_equity():
    """YYY holds closed-end funds; its turnover is allocation noise, not conviction."""
    assert get_fund_category("YYY") == "option-income"


def test_amplify_thematic_funds_stay_active_equity():
    """The override must be per-fund, not a blanket provider flip."""
    for fund in ["BLOK", "HACK", "SILJ", "IBUY", "AIEQ"]:
        assert get_fund_category(fund) == "active-equity", fund


def test_unknown_fund_defaults_to_active_equity():
    assert get_fund_category("ZZZZ") == "active-equity"


# ─── One definition, not two ─────────────────────────────────────────────────

def test_institutional_is_exactly_the_inverse_of_income():
    """The split-brain regression guard.

    is_institutional_fund() used to key off a NARROWER provider set than
    get_fund_category(), so BLOX and EGG* were option-income in the UI and
    stock-pickers in the math simultaneously.
    """
    for fund in FUND_PROVIDERS:
        assert is_institutional_fund(fund) == (get_fund_category(fund) == "active-equity"), fund


@pytest.mark.parametrize("fund", ["BLOX", "EGGQ", "EGGY", "EGGS", "DIVO", "QDVO", "IDVO"])
def test_overlay_funds_excluded_from_institutional_aggregate(fund):
    """These are the funds that used to leak into the institutional blend."""
    assert not is_institutional_fund(fund)


def test_effectiveness_option_funds_match_the_classifier():
    """effectiveness.py must not maintain its own fund list."""
    expected = {f for f in FUND_PROVIDERS if get_fund_category(f) == "option-income"}
    assert effectiveness.OPTION_FUNDS == expected


# ─── The invariant that catches a new overlay fund ───────────────────────────

def _latest_snapshot():
    files = sorted(glob.glob(os.path.join(HISTORY_DIR, "holdings_*.csv")))
    return files[-1] if files else None


def test_every_fund_writing_options_is_classified_income():
    """A fund holding WRITTEN (short) option rows is an income fund, full stop.

    This is the guard that makes the per-fund override list maintainable: when
    a provider launches an overlay fund, or an existing shop adds one, this
    fails in CI instead of the fund quietly polluting the equity signals the
    way DIVO/QDVO/IDVO did.
    """
    snapshot = _latest_snapshot()
    if not snapshot:
        pytest.skip("no history snapshots available")

    writers = set()
    with open(snapshot, newline="") as fh:
        for row in csv.DictReader(fh):
            if not (row.get("Option_Type") or "").strip():
                continue
            try:
                qty = float(row.get("Share Quantity") or 0)
            except ValueError:
                continue
            if qty < 0:  # negative quantity == written/short
                writers.add(row["ETF Ticker"])

    misclassified = sorted(f for f in writers if get_fund_category(f) != "option-income")
    assert not misclassified, (
        f"These funds hold written option positions but are classified "
        f"active-equity: {misclassified}. Add them to _OPTION_INCOME_FUNDS in "
        f"api/data.py AND OPTION_INCOME_FUNDS in etf-dashboard/lib/providers.ts."
    )


def test_classifier_covers_every_fund_in_the_latest_snapshot():
    """No fund should fall through to the 'unknown' default unnoticed."""
    snapshot = _latest_snapshot()
    if not snapshot:
        pytest.skip("no history snapshots available")

    with open(snapshot, newline="") as fh:
        funds = {row["ETF Ticker"] for row in csv.DictReader(fh) if row.get("ETF Ticker")}

    unmapped = sorted(f for f in funds if f not in FUND_PROVIDERS)
    assert not unmapped, f"Funds present in holdings but absent from FUND_PROVIDERS: {unmapped}"
