"""
Tests for api/mcp_server.py — the FastMCP tool surface.

Every ported tool calls the exact same api/data.py / api/income.py functions
that already back the public REST API in api/server.py — no new computation
was introduced. That matters for the data-licensing guard (CLAUDE.md: never
return raw vendor rows on /api/v1 or either MCP): those functions already
shape their output for the REST layer, so the MCP tools inherit that shaping
for free rather than re-deriving it. `test_ported_tools_never_expose_raw_vendor_columns`
pins that directly.

Fixture-backed tests use tests/fixtures/ (ARKK holding TSLA/NVDA/COIN/PLTR)
via the `data_with_fixtures` fixture from conftest.py, mirroring
tests/test_data.py. A few tools don't key off HISTORY_DIR at all (income
classification, the CBOE scan cache, the signal-performance cache) — those
run against whatever real data is checked into the repo and skip gracefully
when it's absent, mirroring the "Live data" section of tests/test_income.py.
"""

import pytest

from api import mcp_server as mcp

# Vendor columns that must never reach an API consumer, human or agent.
RAW_VENDOR_KEYS = {"CUSIP", "cusip", "ISIN", "SEDOL", "Coupon",
                    "Maturity Date", "CreationUnits", "Country"}


def _assert_no_raw_vendor_keys(obj, path="root"):
    """Recursively assert no dict in `obj` carries a raw vendor column."""
    if isinstance(obj, dict):
        leaked = RAW_VENDOR_KEYS & set(obj.keys())
        assert not leaked, f"raw vendor column(s) {leaked} leaked at {path}"
        for k, v in obj.items():
            _assert_no_raw_vendor_keys(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj[:5]):  # sample — these lists can be long
            _assert_no_raw_vendor_keys(v, f"{path}[{i}]")


# ─── Full tool surface ───────────────────────────────────────────────────────

EXPECTED_TOOLS = {
    # Original 8
    "get_signals", "get_changes", "get_fund_detail", "get_ticker_detail",
    "get_sector_flow", "get_divergences", "get_layering_patterns",
    "get_market_summary",
    # Ported
    "get_briefing", "get_institutional_flow", "get_institutional_trend",
    "get_holdings_changes", "get_stock_activity", "list_all_funds",
    "list_all_tickers", "get_income_overview", "get_income_fund_detail",
    "get_options_listings", "get_signal_performance", "get_global_stats",
    # Added 2026-09-27
    "get_option_structures",
}


def test_all_expected_tools_are_registered_with_fastmcp():
    import asyncio
    tools = asyncio.run(mcp.mcp.list_tools())
    names = {t.name for t in tools}
    assert EXPECTED_TOOLS <= names
    assert len(names) == len(EXPECTED_TOOLS), (
        f"expected exactly {len(EXPECTED_TOOLS)} tools, server advertises {len(names)}"
    )


# ─── Fixture-backed ported tools ─────────────────────────────────────────────

def test_get_briefing_shape(data_with_fixtures):
    briefing = mcp.get_briefing()
    for key in ("topBuys", "topSells", "crossFundConvergence",
                "activeStreaks", "notableOptions"):
        assert key in briefing


def test_get_institutional_flow_shape(data_with_fixtures):
    flow = mcp.get_institutional_flow(period="daily", limit=10)
    assert isinstance(flow, dict)


def test_get_institutional_trend_shape(data_with_fixtures):
    trend = mcp.get_institutional_trend(limit=10)
    assert isinstance(trend, dict)


def test_get_holdings_changes_matches_get_changes_on_defaults(data_with_fixtures):
    """Same underlying data as get_changes when called with default args."""
    old = mcp.get_changes()
    new = mcp.get_holdings_changes()
    assert old["asOfDate"] == new["asOfDate"]
    assert {c["ticker"] for c in old["changes"]} == {c["ticker"] for c in new["changes"]}


def test_get_holdings_changes_weekly_period(data_with_fixtures):
    result = mcp.get_holdings_changes(period="weekly", limit=5)
    assert result["asOfDate"] == data_with_fixtures.get_as_of_date()
    assert len(result["changes"]) <= 5


def test_get_holdings_changes_filters_by_fund(data_with_fixtures):
    result = mcp.get_holdings_changes(fund="ARKK")
    assert all(c["fund"] == "ARKK" for c in result["changes"])


def test_get_stock_activity_known_ticker(data_with_fixtures):
    detail = mcp.get_stock_activity("TSLA")
    assert detail["ticker"] == "TSLA"
    assert detail["fundCount"] >= 1
    assert "institutional" in detail
    assert "history" in detail


def test_get_stock_activity_unknown_ticker(data_with_fixtures):
    detail = mcp.get_stock_activity("NOTATICKER")
    assert "error" in detail


def test_list_all_funds_shape(data_with_fixtures):
    result = mcp.list_all_funds()
    assert "funds" in result and "asOfDate" in result
    assert any(f["fund"] == "ARKK" for f in result["funds"])


def test_list_all_funds_category_filter(data_with_fixtures):
    result = mcp.list_all_funds(category="active-equity")
    assert result["category"] == "active-equity"


def test_list_all_tickers_shape(data_with_fixtures):
    result = mcp.list_all_tickers(limit=10)
    assert "tickers" in result and "count" in result
    assert result["count"] <= 10


def test_get_global_stats_shape(data_with_fixtures):
    stats = mcp.get_global_stats()
    for key in ("fundsTracked", "uniqueTickers", "optionsContracts",
                "putCallRatio", "newPositionsToday", "exitsToday"):
        assert key in stats


# ─── Data-licensing guard ────────────────────────────────────────────────────

def test_ported_tools_never_expose_raw_vendor_columns(data_with_fixtures):
    _assert_no_raw_vendor_keys(mcp.get_briefing(), "get_briefing")
    _assert_no_raw_vendor_keys(mcp.get_holdings_changes(), "get_holdings_changes")
    _assert_no_raw_vendor_keys(mcp.get_stock_activity("TSLA"), "get_stock_activity")
    _assert_no_raw_vendor_keys(mcp.list_all_funds(), "list_all_funds")
    _assert_no_raw_vendor_keys(mcp.list_all_tickers(), "list_all_tickers")
    _assert_no_raw_vendor_keys(mcp.get_global_stats(), "get_global_stats")


# ─── Live-data tools (independent of HISTORY_DIR fixtures) ──────────────────

def test_get_income_overview_shape():
    overview = mcp.get_income_overview()
    assert "fundCount" in overview
    assert overview["fundCount"] >= 0


def test_get_income_fund_detail_known_fund_or_absent():
    """Mirrors test_income.py's skip pattern: YieldMax scrapes can fail
    independently, so absence of one fund shouldn't fail unrelated PRs."""
    overview = mcp.get_income_overview()
    funds = {f["fund"] for f in overview.get("funds", [])}
    if "ULTY" not in funds:
        pytest.skip("ULTY absent from today's holdings (partial scrape?)")
    detail = mcp.get_income_fund_detail("ULTY")
    assert "error" not in detail
    assert detail["fund"] == "ULTY"


def test_get_income_fund_detail_rejects_non_income_fund():
    detail = mcp.get_income_fund_detail("ARKK")
    assert "error" in detail


def test_get_options_listings_shape():
    result = mcp.get_options_listings()
    assert isinstance(result, dict)


def test_get_signal_performance_shape_or_cache_missing():
    result = mcp.get_signal_performance()
    assert isinstance(result, dict)
    # Either the real cache (has totalSignals) or our explicit "not generated
    # yet" error dict — never a crash either way.
    assert "totalSignals" in result or "error" in result


def test_remote_mcp_endpoint_mounted_without_shadowing_rest():
    """/mcp is served by the FastMCP HTTP app mounted last on the REST app;
    existing REST routes must still win over the catch-all mount."""
    from fastapi.testclient import TestClient
    from api.server import app

    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
        assert client.get("/nope").status_code == 404
        init = client.post(
            "/mcp",
            headers={"Accept": "application/json, text/event-stream"},
            json={"jsonrpc": "2.0", "id": 1, "method": "initialize",
                  "params": {"protocolVersion": "2025-03-26", "capabilities": {},
                             "clientInfo": {"name": "t", "version": "0"}}},
        )
        assert init.status_code == 200
        assert "TickerTrace" in init.text


# ─── Tool annotations ────────────────────────────────────────────

def _check_annotations(tools):
    assert len(tools) == 21
    for t in tools:
        assert t.annotations is not None, f"{t.name} has no annotations"
        # Wire-format (camelCase) dump: the SDK is renaming the Python attributes
        # (destructiveHint -> destructive_hint), but the JSON clients see is stable.
        a = t.annotations.model_dump(by_alias=True)
        assert a["readOnlyHint"] is True, t.name
        assert a["destructiveHint"] is False, t.name
        assert a["idempotentHint"] is True, t.name
        assert a["openWorldHint"] is False, t.name
        assert a["title"] and a["title"].strip(), f"{t.name} has no title"


def test_every_tool_is_annotated_read_only():
    import asyncio
    from fastmcp import Client

    async def _list():
        async with Client(mcp.mcp) as c:
            return await c.list_tools()

    _check_annotations(asyncio.run(_list()))


def test_remote_http_path_exposes_annotations():
    from fastapi.testclient import TestClient
    from api.server import app

    headers = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
    with TestClient(app) as c:
        r = c.post("/mcp/", headers=headers, json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert r.status_code == 200, r.text
    body = r.text
    if body.lstrip().startswith("event:") or "data:" in body:
        import json
        body = next(l[5:] for l in body.splitlines() if l.startswith("data:"))
    tools = __import__("json").loads(body)["result"]["tools"]
    assert len(tools) == 21
    for t in tools:
        a = t["annotations"]
        assert a["readOnlyHint"] is True and a["destructiveHint"] is False, t["name"]
        assert a["title"], t["name"]
