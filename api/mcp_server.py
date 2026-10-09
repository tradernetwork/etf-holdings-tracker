"""
TickerTrace FastMCP Server

Model Context Protocol server — lets AI agents query institutional ETF signals.

Usage:
    python -m api.mcp_server

MCP tools exposed:
    - get_signals: Top buying/selling signals with conviction scores
    - get_changes: All daily position changes (filterable)
    - get_fund_detail: Full holdings for a specific fund
    - get_ticker_detail: Cross-fund detail for a specific ticker
    - get_sector_flow: Money flowing in/out of sectors
    - get_divergences: Cross-fund conflicts
    - get_layering_patterns: Cross-fund "layering" — multiple pickers opening
      the same new position within days of each other
    - get_market_summary: Stats + signals + sector flow + divergences in one call
    - get_briefing: Pre-market briefing — top moves, convergence, streaks, options
    - get_institutional_flow: Blended AUM-weighted net buy/sell across all funds
    - get_institutional_trend: Per-ticker day/week/month institutional A/D trend
    - get_holdings_changes: Position changes over a daily/weekly/monthly window,
      filterable by provider/fund/direction/category
    - get_stock_activity: Per-stock holders + institutional A/D trend + history
    - list_all_funds: Every tracked fund with holdings counts and top holding
    - list_all_tickers: Most widely-held underlying tickers across all funds
    - get_income_overview: Every option-income fund, classified by structure
    - get_income_fund_detail: One option-income fund's full book
    - get_options_listings: CBOE daily diff of newly-optionable / weekly-options stocks
    - get_signal_performance: Backtest stats for historical buy/sell signals
    - get_global_stats: Funds tracked, unique underlyings, options counts
    - get_option_structures: One underlying's option legs across funds, grouped
      into synthetics / spreads / collars / rolls

This server runs in-process next to api/data.py and calls its functions
directly rather than round-tripping over HTTP to the public REST API.
"""

from fastmcp import FastMCP
from mcp.types import ToolAnnotations
from . import data
from . import income
from . import structures

mcp = FastMCP("TickerTrace")


def _read_only(title: str) -> ToolAnnotations:
    """Annotations shared by every tool: they only read pre-built local
    holdings files (no writes, no external services). tests/test_mcp_server.py
    fails if a new tool ships without them."""
    return ToolAnnotations(
        title=title,
        readOnlyHint=True,
        destructiveHint=False,
        idempotentHint=True,
        openWorldHint=False,
    )


@mcp.tool(annotations=_read_only("Top Buy/Sell Signals"))
def get_signals() -> dict:
    """
    Get today's top institutional buying and selling signals.
    Signals are ranked by conviction score (AUM-weighted, multi-provider bonus).
    Returns buying and selling lists with ticker, funds, providers, and conviction.
    """
    return data.get_signals()


@mcp.tool(annotations=_read_only("Daily Position Changes"))
def get_changes(provider: str = "", fund: str = "", direction: str = "") -> dict:
    """
    Get all daily position changes across tracked ETFs.

    Args:
        provider: Filter by provider name (e.g. 'ARK Invest', 'Kurv', 'YieldMax')
        fund: Filter by specific fund ticker (e.g. 'ARKK', 'KYLD')
        direction: Filter by 'buying' or 'selling'

    Returns:
        List of position changes sorted by absolute weight delta.
    """
    changes = data.compute_daily_changes()

    if fund:
        changes = [c for c in changes if c['fund'] == fund.upper()]
    elif provider:
        changes = [c for c in changes
                   if data.FUND_PROVIDERS.get(c['fund'], c['fund']) == provider]

    # Drift-adjusted: raw weight moves with price even when nobody trades.
    if direction == 'buying':
        changes = [c for c in changes if c['activeWeightDelta'] > 0]
    elif direction == 'selling':
        changes = [c for c in changes if c['activeWeightDelta'] < 0]

    return {
        'asOfDate': data.get_as_of_date(),
        'count': len(changes[:50]),
        'changes': changes[:50],
    }


@mcp.tool(annotations=_read_only("Fund Holdings Detail"))
def get_fund_detail(fund: str) -> dict:
    """
    Get full detail for a specific ETF fund.

    Args:
        fund: ETF ticker (e.g. 'ARKK', 'AVUV', 'KYLD')

    Returns:
        Provider, AUM, holdings count, top 20 holdings with weights and shares.
    """
    detail = data.get_fund_detail(fund.upper())
    return detail or {"error": f"Fund '{fund.upper()}' not found"}


@mcp.tool(annotations=_read_only("Ticker Cross-Fund Detail"))
def get_ticker_detail(ticker: str) -> dict:
    """
    Get cross-fund detail for a specific stock ticker.
    Shows every fund holding this ticker, their weights, and share counts.

    Args:
        ticker: Stock ticker (e.g. 'TSLA', 'NVDA', 'AMZN')

    Returns:
        Fund-by-fund breakdown of the position.
    """
    detail = data.get_ticker_detail(ticker.upper())
    return detail or {"error": f"Ticker '{ticker.upper()}' not found"}


@mcp.tool(annotations=_read_only("Sector Flow"))
def get_sector_flow() -> dict:
    """
    Get sector-level weight changes.
    Shows which economic sectors are seeing institutional inflows vs outflows.

    Returns:
        Inflows and outflows lists with sector name and weight delta.
    """
    return data.get_sector_flow()


@mcp.tool(annotations=_read_only("Cross-Fund Divergences"))
def get_divergences() -> list:
    """
    Get cross-fund divergences — tickers where different funds disagree.
    One fund is buying while another is selling the same ticker.
    These are rare and notable.

    Returns:
        List of divergences with buying and selling fund lists.
    """
    return data.get_divergences()


@mcp.tool(annotations=_read_only("Layering Patterns"))
def get_layering_patterns(window_days: int = 7, min_funds: int = 3, limit: int = 20) -> dict:
    """
    Get cross-fund "layering" patterns — tickers where multiple institutional
    stock-pickers each opened a BRAND-NEW position within a few trading days of
    each other. This is real-time consensus building that quarterly 13F data
    can't see; the entry order (who moved first) often precedes a breakout.

    Args:
        window_days: trading-day window the entries must fall within (default 7).
        min_funds: minimum distinct funds required to count as layering (default 3).
        limit: maximum number of patterns to return, ranked by strength (default 20).

    Returns:
        Patterns ranked by conviction (cross-family agreement weighted highest),
        each with the full entry sequence: fund, provider, entry date, and weight.
    """
    return data.compute_layering_patterns(
        window_days=window_days, min_funds=min_funds, limit=limit
    )


@mcp.tool(annotations=_read_only("Market Summary"))
def get_market_summary() -> dict:
    """
    Get a complete market summary: stats, top signals, sector flow, and divergences.
    Best for getting a quick overview of institutional activity today.
    """
    return data.get_full_payload()


@mcp.tool(annotations=_read_only("Pre-Market Briefing"))
def get_briefing() -> dict:
    """
    Get the pre-market institutional briefing.
    Returns top institutional buys, top sells, multi-provider convergence,
    active accumulation streaks, and notable new option positions.
    """
    return data.get_briefing()


@mcp.tool(annotations=_read_only("Institutional Flow"))
def get_institutional_flow(period: str = "daily", limit: int = 25) -> dict:
    """
    Get aggregate institutional accumulation and distribution flow.
    Blends every stock-picking fund (pure option-income funds excluded) into
    one AUM-weighted portfolio and reports which tickers institutions as a
    whole are net buying or selling.

    Args:
        period: Comparison window — 'daily', 'weekly', or 'monthly' (default 'daily').
        limit: Max tickers to return (default 25).

    Returns:
        Net buying/selling tickers for the combined institutional book.
    """
    return data.compute_institutional_flow(period=period, limit=limit)


@mcp.tool(annotations=_read_only("Institutional Trend"))
def get_institutional_trend(limit: int = 15) -> dict:
    """
    Get per-ticker institutional accumulation/distribution trend across all
    horizons (day/week/month) at once, ranked by the monthly move.

    Args:
        limit: Max tickers to return (default 15).

    Returns:
        Tickers with day/week/month blended-weight deltas and an A/D signal.
    """
    return data.compute_institutional_trend(limit=limit)


@mcp.tool(annotations=_read_only("Holdings Changes Over a Window"))
def get_holdings_changes(
    provider: str = "",
    fund: str = "",
    direction: str = "",
    period: str = "daily",
    limit: int = 50,
    category: str = "",
) -> dict:
    """
    Get institutional position changes over a daily/weekly/monthly window,
    filterable by provider, fund, direction, and fund category.

    This is `get_changes` with the wider window and category filter that the
    public REST API's /api/v1/changes also supports — kept as a separate tool
    (rather than changing get_changes' signature) so existing callers of
    get_changes see no behavior change.

    Args:
        provider: Filter by provider name (e.g. 'ARK Invest', 'Kurv', 'YieldMax')
        fund: Filter by specific fund ticker (e.g. 'ARKK', 'KYLD')
        direction: Filter by 'buying' or 'selling'
        period: Comparison window — 'daily', 'weekly', or 'monthly' (default 'daily').
        limit: Max rows to return (default 50, up to 5000 — value funds like
            AVUV generate well over a thousand small daily changes).
        category: Restrict to 'active-equity' or 'option-income'. Omit for all.

    Returns:
        List of position changes sorted by absolute weight delta.
    """
    if period == "weekly":
        changes = data.compute_weekly_changes()
    elif period == "monthly":
        changes = data.compute_monthly_changes()
    else:
        changes = data.compute_daily_changes()

    if category:
        changes = [c for c in changes if c.get("fundCategory") == category]

    if fund:
        changes = [c for c in changes if c['fund'] == fund.upper()]
    elif provider:
        changes = [c for c in changes
                   if data.FUND_PROVIDERS.get(c['fund'], c['fund']) == provider]

    # Drift-adjusted: raw weight moves with price even when nobody trades.
    if direction == 'buying':
        changes = [c for c in changes if c['activeWeightDelta'] > 0]
    elif direction == 'selling':
        changes = [c for c in changes if c['activeWeightDelta'] < 0]

    return {
        'asOfDate': data.get_as_of_date(),
        'count': len(changes[:limit]),
        'changes': changes[:limit],
    }


@mcp.tool(annotations=_read_only("Stock Activity"))
def get_stock_activity(ticker: str) -> dict:
    """
    Get complete institutional activity for a single stock: current fund
    holders (like get_ticker_detail) plus the AUM-blended institutional
    accumulation/distribution trend and a trading-day history series.

    Args:
        ticker: Stock ticker symbol (e.g. 'AAPL', 'NVDA', 'TSLA', 'AVGO').

    Returns:
        Holders, recent changes, and the day/week/month institutional trend.
    """
    detail = data.get_stock_detail(ticker.upper())
    return detail or {"error": f"Ticker '{ticker.upper()}' not found"}


@mcp.tool(annotations=_read_only("List Tracked Funds"))
def list_all_funds(category: str = "") -> dict:
    """
    List all tracked institutional funds, enriched with holdings counts,
    options counts, and top holding.

    Args:
        category: Restrict to 'active-equity' or 'option-income'. Omit for all.

    Returns:
        Fund list plus asOfDate and the category filter applied (if any).
    """
    return {
        "funds": data.get_funds_index(category=category or None),
        "asOfDate": data.get_as_of_date(),
        "category": category or None,
    }


@mcp.tool(annotations=_read_only("List Held Tickers"))
def list_all_tickers(limit: int = 100, sort: str = "funds", category: str = "") -> dict:
    """
    List the most widely-held underlying tickers across all tracked funds.

    Args:
        limit: Max tickers to return (default 100).
        sort: 'funds' ranks by how many funds hold the name; 'weight' ranks by
            total weight summed across funds (default 'funds').
        category: Restrict to 'active-equity' or 'option-income'. Omit for all.

    Returns:
        Ranked ticker list, each with net daily weight change for momentum.
    """
    tickers = data.get_tickers_index(limit=limit, sort=sort, category=category or None)
    return {"count": len(tickers), "asOfDate": data.get_as_of_date(), "tickers": tickers}


@mcp.tool(annotations=_read_only("Option-Income Funds Overview"))
def get_income_overview() -> dict:
    """
    Get coverage and structural classification for all option-income funds.

    "Income ETF" is not one thing — funds fall into five structurally
    different shapes (covered-call, synthetic, leap-proxy, swap, short-equity)
    and each carries the six coverage tiles (call coverage, weighted
    moneyness, weighted DTE, upside room, capped names, collateral mix). Any
    tile that cannot be computed from current data is null rather than 0.
    """
    return income.get_income_overview()


@mcp.tool(annotations=_read_only("Option-Income Fund Detail"))
def get_income_fund_detail(fund: str) -> dict:
    """
    Get an option-income fund's full book — one row per underlying, not per
    contract — with call coverage, moneyness, and options overlay details.

    Args:
        fund: Option-income fund ticker (e.g. 'ULTY', 'KYLD', 'QDTE').

    Returns:
        The fund's book, or an error if it isn't a tracked option-income fund.
        `incomeLegVisible` is false for leap-proxy funds (QDTE/XDTE/RDTE):
        their 0DTE contracts open and expire inside a session, so no
        end-of-day file has ever contained one.
    """
    book = income.get_income_fund(fund.upper())
    return book or {"error": f"'{fund.upper()}' is not a tracked option-income fund"}


@mcp.tool(annotations=_read_only("CBOE Options Listings"))
def get_options_listings() -> dict:
    """
    Get the CBOE Options Scanner daily diff of CBOE's published option
    universe: stocks gaining options for the first time (Symbol Directory)
    and weekly-options promotions/demotions (Available Weeklys).

    Returns:
        The last 7 days of scan history; `latest` is the newest scan.
    """
    import cboe_scanner
    return cboe_scanner.read_options_listings()


@mcp.tool(annotations=_read_only("Signal Backtest Performance"))
def get_signal_performance() -> dict:
    """
    Get historical backtest performance for TickerTrace conviction signals:
    median forward return + win rate, overall and per fund family.

    Pre-computed nightly by `python -m api.signal_performance` and served
    from a JSON cache on disk.
    """
    from api import signal_performance
    cached = signal_performance.read_cache()
    if cached is None:
        return {
            "error": "Signal performance cache not yet generated. Run "
                     "`python -m api.signal_performance` to build it."
        }
    return cached


@mcp.tool(annotations=_read_only("Global Stats"))
def get_global_stats() -> dict:
    """
    Get global tracking stats: funds tracked, unique underlyings, options
    contracts, put/call ratio, and today's new positions/exits.
    """
    return data.get_global_stats()



@mcp.tool(annotations=_read_only("Option Structures"))
def get_option_structures(underlying: str) -> dict:
    """
    Get every tracked fund's option legs on one underlying, grouped into
    structures instead of a flat CALL/PUT list.

    Args:
        underlying: Stock ticker the options are written on (e.g. 'AMD', 'MSTR').

    Returns:
        Per fund: `legs` (signed contracts — negative = written — plus
        optionType CALL/PUT, strike, expiry, isFlex, change vs. the fund's
        previous snapshot), `structures` as held (synthetic-long/short,
        call/put spreads with credit/debit side, collars, singles) and
        `trades` pairing today's changes (roll / synthetic / spread / collar).
        A synthetic long is stock exposure, not two option trades.
    """
    result = structures.get_option_structures(underlying.upper())
    return result or {"error": f"No tracked fund holds options on {underlying.upper()}"}

if __name__ == "__main__":
    mcp.run()
