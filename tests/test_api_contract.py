"""
Backwards-compatibility contract for the public API.

api.tickertrace.pro is open — no key, no auth, unknown consumers. The
income/equity split added a `category` query param to several endpoints and
new fields to several payloads. Every one of those additions must be additive:
a caller that has never heard of `category` must see exactly what it saw
before.

These tests pin that. They assert the SHAPE (keys, types, filter semantics),
not the values, so a fresh scrape doesn't turn them red.
"""

import pytest

pytest.importorskip("fastapi")

from fastapi.testclient import TestClient

from api.server import app
from api import data

client = TestClient(app)

CATEGORIES = ["active-equity", "option-income"]

# Keys that existed before the split and must never disappear.
LEGACY_STATS_KEYS = {
    "fundsTracked", "uniqueTickers", "optionsContracts",
    "putCallRatio", "newPositionsToday", "exitsToday",
}
LEGACY_SIGNAL_KEYS = {"ticker", "convictionScore", "weightDelta", "funds"}
LEGACY_DIVERGENCE_KEYS = {"ticker", "name", "buying", "selling", "buyingFunds",
                          "sellingFunds", "intrashop"}


# ─── Default behaviour is unchanged ──────────────────────────────────────────

@pytest.mark.parametrize("path", [
    "/api/v1/signals",
    "/api/v1/stats",
    "/api/v1/sectors",
    "/api/v1/divergences",
    "/api/v1/changes",
    "/api/v1/funds",
    "/api/v1/tickers",
])
def test_endpoint_responds_without_category(path):
    """No caller is required to know the param exists."""
    assert client.get(path).status_code == 200


def test_signals_legacy_keys_present():
    body = client.get("/api/v1/signals").json()
    for key in ("asOfDate", "stats", "signals", "changes", "sectorFlow",
                "divergences", "briefing", "activity"):
        assert key in body, key
    assert LEGACY_STATS_KEYS <= set(body["stats"])
    for side in ("buying", "selling"):
        assert side in body["signals"]
        for row in body["signals"][side][:3]:
            assert LEGACY_SIGNAL_KEYS <= set(row)


def test_divergences_legacy_shape():
    for row in client.get("/api/v1/divergences").json()[:5]:
        assert LEGACY_DIVERGENCE_KEYS <= set(row)
        # The plain lists are the original, documented shape.
        assert isinstance(row["buying"], list)
        assert all(isinstance(f, str) for f in row["buying"])


def test_unfiltered_matches_explicit_none():
    """Passing no category must equal passing None internally."""
    assert data.get_divergences() == data.get_divergences(category=None)
    assert data.get_signals() == data.get_signals(category=None)


# ─── The new param behaves ───────────────────────────────────────────────────

@pytest.mark.parametrize("path", [
    "/api/v1/signals", "/api/v1/sectors", "/api/v1/divergences",
    "/api/v1/changes", "/api/v1/funds", "/api/v1/tickers",
])
@pytest.mark.parametrize("category", CATEGORIES)
def test_category_param_accepted(path, category):
    assert client.get(f"{path}?category={category}").status_code == 200


@pytest.mark.parametrize("path", ["/api/v1/signals", "/api/v1/changes", "/api/v1/funds"])
def test_bad_category_is_rejected(path):
    assert client.get(f"{path}?category=bogus").status_code == 422


def test_changes_category_filters_to_that_category():
    for category in CATEGORIES:
        body = client.get(f"/api/v1/changes?category={category}&limit=200").json()
        assert body["changes"], f"no changes for {category}"
        assert all(c["fundCategory"] == category for c in body["changes"])


def test_funds_category_partitions_the_universe():
    total = len(client.get("/api/v1/funds").json()["funds"])
    parts = sum(
        len(client.get(f"/api/v1/funds?category={c}").json()["funds"])
        for c in CATEGORIES
    )
    assert parts == total


def test_funds_echoes_applied_category():
    assert client.get("/api/v1/funds").json()["category"] is None
    body = client.get("/api/v1/funds?category=option-income").json()
    assert body["category"] == "option-income"
    assert all(f["category"] == "option-income" for f in body["funds"])


# ─── New additive fields ─────────────────────────────────────────────────────

def test_change_records_carry_fund_category():
    for c in client.get("/api/v1/changes?limit=50").json()["changes"]:
        assert c["fundCategory"] in CATEGORIES


def test_divergences_carry_cross_category_flag():
    rows = client.get("/api/v1/divergences").json()
    for row in rows:
        assert isinstance(row["crossCategory"], bool)
        cats = {f["category"] for f in row["buyingFunds"] + row["sellingFunds"]}
        assert row["crossCategory"] == (len(cats) > 1)


def test_cross_category_divergences_sort_last():
    """They were auto-expanding the dashboard card as 'intra-shop conflicts'."""
    flags = [r["crossCategory"] for r in client.get("/api/v1/divergences").json()]
    assert flags == sorted(flags), "crossCategory rows must sink below real conflicts"


def test_equity_filter_removes_cross_category_divergences():
    rows = client.get("/api/v1/divergences?category=active-equity").json()
    assert all(not r["crossCategory"] for r in rows)


# ─── The load-bearing invariant ──────────────────────────────────────────────

def test_active_weight_denominator_unaffected_by_category_filter():
    """Filtering must happen AFTER the diff, never to the rows going in.

    _active_weight_deltas is zero-sum within a fund and renormalizes over the
    whole book. If a category filter were applied to the input rows, every
    surviving position's drift-adjusted delta would shift. Same fund, same
    position, same number — regardless of the filter.
    """
    unfiltered = {
        (c["fund"], c["ticker"]): c["activeWeightDelta"]
        for c in data.compute_daily_changes()
    }
    assert unfiltered, "no changes to compare"

    for category in CATEGORIES:
        filtered = data._filter_by_category(data.compute_daily_changes(), category)
        assert filtered, f"no changes for {category}"
        for c in filtered:
            assert c["activeWeightDelta"] == unfiltered[(c["fund"], c["ticker"])], (
                f"{c['fund']}/{c['ticker']} active weight changed under a "
                f"{category} filter — the filter is being applied too early"
            )


# ─── Agent discoverability: llms.txt + OpenAPI spec ──────────────

def test_llms_txt_served_as_plain_text():
    r = client.get("/llms.txt")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/plain")
    assert r.text.startswith("# TickerTrace")
    assert "https://api.tickertrace.pro/mcp" in r.text


def test_openapi_has_servers_and_hides_internal_routes():
    spec = client.get("/openapi.json").json()
    assert spec["servers"] == [{"url": "https://api.tickertrace.pro"}]
    assert "/api/v1/signals" in spec["paths"]
    for hidden in ("/api/v1/visits/track", "/api/v1/visits/live", "/api/v1/traderdaddy", "/llms.txt"):
        assert hidden not in spec["paths"]
    assert "ARK Invest, Avantis" not in spec["info"]["description"]
