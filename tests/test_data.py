"""
Tests for api/data.py — the business logic that takes raw holdings CSVs and
produces signals, changes, sector flow, divergences. These are the most
important things to not break, since they drive the public API.

Fixtures live in tests/fixtures/. The conftest fixture re-points
api.data.HISTORY_DIR at that directory so the tests don't depend on
production data files.
"""

import os


def test_read_csv_dedupes_by_fund_ticker(tmp_path, monkeypatch):
    """Regression: the Corgi Funds JSON API returns a historical time-series
    rather than today's snapshot, so its rows can appear N times in a daily
    CSV — once per past holding_date. _read_csv must collapse to one row per
    (fund, ticker), keeping the most-recent holding_date. Without this fix,
    /api/v1/ticker/GOOGL was showing CMAG holding GOOGL 8 times.
    """
    from api import data as _data

    csv_path = tmp_path / "holdings_2026-05-16.csv"
    # Three rows for (CMAG, GOOGL) at different holding_dates, plus one
    # row for (KQQQ, GOOGL) and one for (CMAG, NVDA) which should pass
    # through untouched.
    csv_path.write_text(
        "ETF Ticker,Ticker,Name,Share Quantity,Weight,holding_date\n"
        "CMAG,GOOGL,Alphabet,1000,1.00,2026-05-07\n"
        "CMAG,GOOGL,Alphabet,605,1.24,2026-05-18\n"  # latest — keep this one
        "CMAG,GOOGL,Alphabet,800,1.10,2026-05-12\n"
        "KQQQ,GOOGL,Alphabet,38220,12.83,2026-05-18\n"
        "CMAG,NVDA,Nvidia,400,2.50,2026-05-18\n"
    )

    rows = _data._read_csv(str(csv_path))

    # Build a quick lookup for assertions.
    keys = [(r["ETF Ticker"], r["Ticker"]) for r in rows]
    assert len(keys) == len(set(keys)), f"duplicates remain: {keys}"
    assert ("CMAG", "GOOGL") in keys
    assert ("KQQQ", "GOOGL") in keys
    assert ("CMAG", "NVDA") in keys

    # The CMAG GOOGL row kept must be the 2026-05-18 one (605 shares).
    cmag_googl = next(r for r in rows if r["ETF Ticker"] == "CMAG" and r["Ticker"] == "GOOGL")
    assert cmag_googl["Share Quantity"] == "605"
    assert cmag_googl["holding_date"] == "2026-05-18"


def test_read_csv_dedupe_without_holding_date_keeps_first(tmp_path):
    """When rows don't carry a holding_date (older provider format),
    _read_csv still dedupes safely — first-seen row wins, downstream
    code is protected from emitting duplicate (fund, ticker) entries."""
    from api import data as _data

    csv_path = tmp_path / "holdings_2026-05-16.csv"
    csv_path.write_text(
        "ETF Ticker,Ticker,Name,Share Quantity,Weight\n"
        "ARKK,TSLA,Tesla,100000,9.20\n"
        "ARKK,TSLA,Tesla,99999,9.19\n"  # bogus dup — should be dropped
    )
    rows = _data._read_csv(str(csv_path))
    assert len(rows) == 1
    assert rows[0]["Share Quantity"] == "100000"


def test_get_available_dates(data_with_fixtures):
    d = data_with_fixtures
    dates = d.get_available_dates()
    # 05-16 is a Saturday — get_available_dates filters non-market days, so the
    # newest snapshot fixture is the Monday (05-18), preceded by Friday (05-15).
    assert dates == ["2026-05-18", "2026-05-15"], "newest-first ordering"


def test_get_as_of_date(data_with_fixtures):
    assert data_with_fixtures.get_as_of_date() == "2026-05-18"


def test_compute_daily_changes_basic_shape(data_with_fixtures):
    changes = data_with_fixtures.compute_daily_changes()
    assert isinstance(changes, list)
    assert len(changes) > 0
    for c in changes:
        # Every row has the expected keys
        for k in ("fund", "ticker", "weightDelta", "type"):
            assert k in c, f"missing key {k} in {c}"


def test_compute_daily_changes_detects_new_position(data_with_fixtures):
    """PLTR appears in 05-16 but not 05-15 → should be a NEW change."""
    changes = data_with_fixtures.compute_daily_changes()
    pltr = [c for c in changes if c["ticker"] == "PLTR" and c["fund"] == "ARKK"]
    assert len(pltr) == 1, "PLTR should appear exactly once for ARKK"
    assert pltr[0]["type"] == "NEW"
    assert pltr[0]["weightDelta"] > 0


def test_compute_daily_changes_detects_weight_change(data_with_fixtures):
    """TSLA weight increased in ARKK from 8.50 → 9.20."""
    changes = data_with_fixtures.compute_daily_changes()
    tsla = [c for c in changes if c["ticker"] == "TSLA" and c["fund"] == "ARKK"]
    assert len(tsla) == 1
    assert tsla[0]["type"] == "CHANGED"
    assert abs(tsla[0]["weightDelta"] - 0.70) < 0.01, "8.50 → 9.20 delta ≈ +0.70"


def test_compute_daily_changes_filters_options(data_with_fixtures):
    """Options should not appear in `changes` — they're tracked separately."""
    changes = data_with_fixtures.compute_daily_changes()
    for c in changes:
        assert not c.get("isOption"), f"option leaked into changes: {c}"
        # The option row's raw ticker contains a space — should never appear.
        assert " " not in c["ticker"], f"option-like ticker leaked: {c}"


def test_compute_daily_changes_filters_junk(data_with_fixtures):
    """CASH, raw CUSIPs, and money-market funds should be filtered."""
    changes = data_with_fixtures.compute_daily_changes()
    bad = {"CASH", "912797RG4", "SPAXX"}
    leaked = [c["ticker"] for c in changes if c["ticker"] in bad]
    assert leaked == [], f"junk tickers leaked: {leaked}"


def test_get_signals_buying_includes_pltr(data_with_fixtures):
    """PLTR is a new ARKK position → should appear in buying signals."""
    signals = data_with_fixtures.get_signals()
    buying_tickers = [s["ticker"] for s in signals["buying"]]
    assert "PLTR" in buying_tickers


def test_get_signals_selling_includes_coin(data_with_fixtures):
    """COIN weight dropped in ARKK (6.10 → 5.50) → should appear in selling."""
    signals = data_with_fixtures.get_signals()
    selling_tickers = [s["ticker"] for s in signals["selling"]]
    assert "COIN" in selling_tickers


def test_get_signals_tsla_aggregates_funds(data_with_fixtures):
    """TSLA moves in ARKK and ARKW → conviction should aggregate."""
    signals = data_with_fixtures.get_signals()
    buying = {s["ticker"]: s for s in signals["buying"]}
    assert "TSLA" in buying
    # ARKK and ARKW are both ARK Invest → one provider, so no multi-provider bonus
    assert set(buying["TSLA"]["providers"]) == {"ARK Invest"}
    # ARKK and ARKW both increased TSLA → both funds should be listed
    assert set(buying["TSLA"]["funds"]) >= {"ARKK", "ARKW"}


def test_get_sector_flow_returns_inflows_and_outflows(data_with_fixtures):
    flow = data_with_fixtures.get_sector_flow()
    assert "inflows" in flow and "outflows" in flow
    assert isinstance(flow["inflows"], list)
    assert isinstance(flow["outflows"], list)


def test_get_full_payload_shape(data_with_fixtures):
    """Smoke test: the headline endpoint returns every advertised key."""
    payload = data_with_fixtures.get_full_payload()
    for k in ("_meta", "asOfDate", "stats", "signals", "changes",
              "sectorFlow", "divergences"):
        assert k in payload, f"missing top-level key: {k}"
    # signals has buying + selling
    assert "buying" in payload["signals"] and "selling" in payload["signals"]


def test_get_full_payload_does_not_re_compute_changes(data_with_fixtures, monkeypatch):
    """
    Review #14 regression guard: get_full_payload should compute the changes
    list exactly once, not four times. After the #10 finale this means
    compute_daily_changes_with_options is the single read; everything else
    derives from its return value.
    """
    counter = {"with_options": 0, "no_options": 0}
    orig_with = data_with_fixtures.compute_daily_changes_with_options
    orig_without = data_with_fixtures.compute_daily_changes

    def counting_with(*args, **kwargs):
        counter["with_options"] += 1
        return orig_with(*args, **kwargs)

    def counting_without(*args, **kwargs):
        counter["no_options"] += 1
        return orig_without(*args, **kwargs)

    monkeypatch.setattr(data_with_fixtures, "compute_daily_changes_with_options", counting_with)
    monkeypatch.setattr(data_with_fixtures, "compute_daily_changes", counting_without)
    data_with_fixtures.get_full_payload()
    total = counter["with_options"] + counter["no_options"]
    assert total == 1, (
        f"compute_daily_changes* was called {total} times in total — "
        "regression of review #14 (the 4x recomputation fix)"
    )


def test_get_fund_detail_returns_holdings(data_with_fixtures):
    detail = data_with_fixtures.get_fund_detail("ARKK")
    assert detail is not None
    assert detail["fund"] == "ARKK"
    assert detail["provider"] == "ARK Invest"
    # Top holdings exclude junk
    tickers = [h["ticker"] for h in detail["topHoldings"]]
    assert "CASH" not in tickers
    assert "TSLA" in tickers


def test_get_fund_detail_unknown_returns_none(data_with_fixtures):
    assert data_with_fixtures.get_fund_detail("NOTAFUND") is None


def test_get_ticker_detail_cross_fund(data_with_fixtures):
    """TSLA is held by ARKK, ARKW, ARKQ → should report all three."""
    detail = data_with_fixtures.get_ticker_detail("TSLA")
    assert detail is not None
    funds = {h["fund"] for h in detail["holdings"]}
    assert funds >= {"ARKK", "ARKW", "ARKQ"}


def test_get_global_stats_counts_options(data_with_fixtures):
    stats = data_with_fixtures.get_global_stats()
    assert stats["fundsTracked"] >= 4  # ARKK, ARKW, ARKQ, AVUV, ULTY, KYLD
    assert stats["optionsContracts"] >= 2  # MSFT call + QQQ put
    assert "asOfDate" in stats  # /api/v1/stats must echo data freshness


# ─── Enriched signals (review #10) ─────────────────────────────────────────


def test_signals_include_enriched_fields(data_with_fixtures):
    """Each signal carries dashboard-shaped fields in addition to legacy ones."""
    signals = data_with_fixtures.get_signals()
    for s in signals["buying"] + signals["selling"]:
        for legacy in ("ticker", "weightDelta", "funds", "providers", "conviction", "direction"):
            assert legacy in s, f"legacy field {legacy} missing from {s}"
        for enriched in ("fundDetails", "fundCount", "providerCount",
                         "totalWeightDelta", "avgWeightDelta", "convictionScore"):
            assert enriched in s, f"enriched field {enriched} missing"
        # fundDetails is per-fund objects, not strings
        for fd in s["fundDetails"]:
            assert {"fund", "weightDelta", "currentWeight", "type"} <= set(fd.keys())


def test_signals_apply_significance_threshold(data_with_fixtures):
    """Moves below the per-fund significance threshold are filtered."""
    # In fixtures: AVUV/F weight is 1.50 → 1.50 (no change), AVUV/GM 1.20 → 1.40 (+0.20)
    # Threshold for AVUV (broad fund) is 0.01. GM passes (+0.20 > 0.01), F doesn't change.
    signals = data_with_fixtures.get_signals()
    avuv_signals = [s for s in signals["buying"] if "AVUV" in s["funds"]]
    # GM appears (delta 0.20), F should not appear from AVUV (no delta)
    tickers = {s["ticker"] for s in avuv_signals}
    assert "GM" in tickers
    assert "F" not in tickers


# ─── Briefing endpoint (review #10) ────────────────────────────────────────


def test_get_briefing_shape(data_with_fixtures):
    briefing = data_with_fixtures.get_briefing()
    for k in ("topBuys", "topSells", "crossFundConvergence",
              "activeStreaks", "notableOptions"):
        assert k in briefing, f"missing key {k}"


def test_briefing_top_buys_capped_at_3(data_with_fixtures):
    briefing = data_with_fixtures.get_briefing()
    assert len(briefing["topBuys"]) <= 3
    assert len(briefing["topSells"]) <= 3


# ─── Activity endpoint (review #10) ────────────────────────────────────────


def test_get_activity_buckets(data_with_fixtures):
    activity = data_with_fixtures.get_activity()
    for k in ("accumulating", "reducing", "optionsActivity"):
        assert k in activity, f"missing key {k}"
    # PLTR (new in ARKK) should be in accumulating
    accum_tickers = {r["ticker"] for r in activity["accumulating"]}
    assert "PLTR" in accum_tickers


def test_activity_options_isolated(data_with_fixtures):
    """Option records go to optionsActivity, not accumulating/reducing."""
    activity = data_with_fixtures.get_activity()
    for r in activity["accumulating"] + activity["reducing"]:
        assert not r.get("isOption"), f"option leaked into equity bucket: {r}"


# ─── Enriched divergences (review #10) ─────────────────────────────────────


def test_divergences_include_intrashop_flag(data_with_fixtures):
    """Divergences expose intrashop bool + per-fund weightDelta lists."""
    divs = data_with_fixtures.get_divergences()
    for d in divs:
        for k in ("ticker", "name", "buying", "selling",
                  "buyingFunds", "sellingFunds", "intrashop"):
            assert k in d
        # Per-fund entries are richer than plain fund-name strings
        for f in d["buyingFunds"] + d["sellingFunds"]:
            assert {"fund", "provider", "weightDelta"} <= set(f.keys())


# ─── Enriched fund/ticker detail (review #10) ──────────────────────────────


def test_fund_detail_has_deltas_and_changes(data_with_fixtures):
    detail = data_with_fixtures.get_fund_detail("ARKK")
    assert detail is not None
    assert "recentChanges" in detail
    # Top holdings now carry weightDelta/sharesDelta
    for h in detail["topHoldings"]:
        assert "weightDelta" in h
        assert "sharesDelta" in h


def test_ticker_detail_has_changes_list(data_with_fixtures):
    detail = data_with_fixtures.get_ticker_detail("TSLA")
    assert detail is not None
    assert "changes" in detail
    # In fixtures TSLA moves in ARKK + ARKW → should show changes
    assert len(detail["changes"]) >= 2


# ─── Full payload now includes briefing + activity ─────────────────────────


def test_full_payload_includes_briefing_and_activity(data_with_fixtures):
    payload = data_with_fixtures.get_full_payload()
    assert "briefing" in payload
    assert "activity" in payload
    # The activity inside should have all three buckets
    for k in ("accumulating", "reducing", "optionsActivity"):
        assert k in payload["activity"]


# ─── Fund categories (active-equity vs option-income) ──────────────────────


def test_get_fund_category_active_equity(data_with_fixtures):
    """Stock-picking funds — Avantis, ARK, Corgi, Sprott — are active-equity."""
    d = data_with_fixtures
    for fund in ("AVUV", "AVLV", "ARKK", "ARKG", "GBUG", "CMAG"):
        assert d.get_fund_category(fund) == "active-equity", fund


def test_get_fund_category_option_income(data_with_fixtures):
    """Option-overlay income funds are option-income."""
    d = data_with_fixtures
    for fund in ("ULTY", "KYLD", "QDTE", "MSTY", "EGGQ", "BLOX"):
        assert d.get_fund_category(fund) == "option-income", fund


def test_get_fund_category_unknown_defaults_active_equity(data_with_fixtures):
    assert data_with_fixtures.get_fund_category("NOTAFUND") == "active-equity"


def test_fund_detail_includes_category(data_with_fixtures):
    detail = data_with_fixtures.get_fund_detail("ARKK")
    assert detail is not None
    assert detail["category"] == "active-equity"


# ─── Calendar-aware weekly / monthly windows ───────────────────────────────


def test_snapshot_for_lookback_is_calendar_aware(tmp_path, monkeypatch):
    """compute_weekly/monthly_changes must pick a snapshot by CALENDAR date,
    not by file index — history cadence is irregular (weekends sometimes
    present, holidays missing), so 'N files ago' drifts off the intended
    window."""
    from api import data as _data

    header = "ETF Ticker,Ticker,Name,Share Quantity,Weight\n"
    # latest 05-21; exactly 7 days back = 05-14; exactly 30 days back = 04-21.
    snapshots = {
        "2026-05-21": "9.0",  # latest
        "2026-05-20": "8.9",
        "2026-05-19": "8.8",
        "2026-05-14": "8.0",  # 7 calendar days before latest
        "2026-05-13": "7.9",
        "2026-04-21": "5.0",  # 30 calendar days before latest
    }
    for d, w in snapshots.items():
        (tmp_path / f"holdings_{d}.csv").write_text(
            header + f"ARKK,TSLA,Tesla,1000,{w}\n"
        )
    monkeypatch.setattr(_data, "HISTORY_DIR", str(tmp_path))

    weekly = _data.compute_weekly_changes()
    tsla_w = next(c for c in weekly if c["ticker"] == "TSLA")
    assert abs(tsla_w["weightDelta"] - (9.0 - 8.0)) < 1e-6, "weekly should compare vs 05-14"

    monthly = _data.compute_monthly_changes()
    tsla_m = next(c for c in monthly if c["ticker"] == "TSLA")
    assert abs(tsla_m["weightDelta"] - (9.0 - 5.0)) < 1e-6, "monthly should compare vs 04-21"


def test_weekly_changes_detect_position_entry_and_exit(tmp_path, monkeypatch):
    """A position present today but absent a week ago is NEW; the reverse is
    REMOVED — the week-over-week entered/exited view for active-equity funds."""
    from api import data as _data

    header = "ETF Ticker,Ticker,Name,Share Quantity,Weight\n"
    (tmp_path / "holdings_2026-05-21.csv").write_text(
        header
        + "ARKK,TSLA,Tesla,1000,9.0\n"
        + "ARKK,PLTR,Palantir,500,3.0\n"   # entered this week
    )
    (tmp_path / "holdings_2026-05-14.csv").write_text(
        header
        + "ARKK,TSLA,Tesla,1000,9.0\n"
        + "ARKK,COIN,Coinbase,200,4.0\n"   # exited this week
    )
    monkeypatch.setattr(_data, "HISTORY_DIR", str(tmp_path))

    weekly = _data.compute_weekly_changes()
    by_ticker = {c["ticker"]: c for c in weekly}
    assert by_ticker["PLTR"]["type"] == "NEW"
    assert by_ticker["COIN"]["type"] == "REMOVED"
    assert "TSLA" not in by_ticker, "unchanged position should not appear"


def test_weekly_changes_fall_back_with_short_history(data_with_fixtures):
    """With only two snapshots, weekly can't reach 7 days back — it falls
    back to the oldest snapshot rather than crashing or returning []."""
    d = data_with_fixtures
    weekly = d.compute_weekly_changes()
    assert isinstance(weekly, list)
    # Fixtures only span 05-15 → 05-16, so the weekly fallback compares the
    # same two snapshots as the daily diff.
    assert len(weekly) == len(d.compute_daily_changes())


def test_get_activity_monthly_returns_buckets(data_with_fixtures):
    activity = data_with_fixtures.get_activity("monthly")
    for k in ("accumulating", "reducing", "optionsActivity"):
        assert k in activity, f"missing key {k}"


# ─── Option analytics on fund detail (Phase 2 groundwork) ──────────────────


def test_fund_detail_surfaces_option_analytics(tmp_path, monkeypatch):
    """optionHoldings carries dte / moneyness / underlyingPrice from the
    scraper columns — nullable, so a blank column reads as None, never a
    misleading real 0 (a 0-DTE contract / at-the-money strike)."""
    from api import data as _data

    header = (
        "ETF Ticker,Ticker,Name,Share Quantity,Weight,Option_Type,"
        "Underlying_Ticker,Option_Strike,Option_Expiry,DTE,Moneyness,Underlying_Price\n"
    )
    (tmp_path / "holdings_2026-05-21.csv").write_text(
        header
        + "ULTY,NVDA 260522C00200000,NVDA Call,10,1.5,Call,NVDA,200,2026-05-22,1,0.05,210.5\n"
        + "ULTY,SCCO 260529P00155000,SCCO Put,5,0.8,Put,SCCO,155,2026-05-29,,,\n"
    )
    (tmp_path / "holdings_2026-05-20.csv").write_text(header)
    monkeypatch.setattr(_data, "HISTORY_DIR", str(tmp_path))

    detail = _data.get_fund_detail("ULTY")
    assert detail is not None
    opts = detail["optionHoldings"]
    assert len(opts) == 2

    nvda = next(o for o in opts if o["ticker"].startswith("NVDA"))
    assert nvda["dte"] == 1.0
    assert abs(nvda["moneyness"] - 0.05) < 1e-9
    assert abs(nvda["underlyingPrice"] - 210.5) < 1e-9

    # Blank analytics columns -> None, NOT 0.0.
    scco = next(o for o in opts if o["ticker"].startswith("SCCO"))
    assert scco["dte"] is None
    assert scco["moneyness"] is None
    assert scco["underlyingPrice"] is None


def test_fund_detail_includes_streaks(tmp_path, monkeypatch):
    """get_fund_detail surfaces per-fund accumulation/distribution streaks —
    drives the streak tracker on the active-equity fund view."""
    from api import data as _data

    header = "ETF Ticker,Ticker,Name,Share Quantity,Weight\n"
    # TSLA weight climbs every day -> a multi-day accumulation streak.
    for d, w in [
        ("2026-05-21", "9.3"),
        ("2026-05-20", "9.2"),
        ("2026-05-19", "9.1"),
        ("2026-05-18", "9.0"),
    ]:
        (tmp_path / f"holdings_{d}.csv").write_text(header + f"ARKK,TSLA,Tesla,100,{w}\n")
    monkeypatch.setattr(_data, "HISTORY_DIR", str(tmp_path))

    detail = _data.get_fund_detail("ARKK")
    assert detail is not None
    assert "streaks" in detail
    streaks = {s["ticker"]: s for s in detail["streaks"]}
    assert "TSLA" in streaks, "a 4-day rising weight should register a streak"
    assert streaks["TSLA"]["direction"] == "up"
    assert streaks["TSLA"]["days"] >= 2


def test_fund_detail_recent_changes_include_options(tmp_path, monkeypatch):
    """recentChanges carries option activity so the option-income view can
    show contracts opened/closed — not just equity rows."""
    from api import data as _data

    header = (
        "ETF Ticker,Ticker,Name,Share Quantity,Weight,Option_Type,"
        "Underlying_Ticker,Option_Strike,Option_Expiry\n"
    )
    (tmp_path / "holdings_2026-05-21.csv").write_text(
        header
        + "ULTY,AAPL,Apple,100,5.0,,,,\n"
        + "ULTY,NVDA 260522C00200000,NVDA Call,10,1.5,Call,NVDA,200,2026-05-22\n"
    )
    (tmp_path / "holdings_2026-05-20.csv").write_text(header + "ULTY,AAPL,Apple,100,5.0,,,,\n")
    monkeypatch.setattr(_data, "HISTORY_DIR", str(tmp_path))

    detail = _data.get_fund_detail("ULTY")
    assert detail is not None
    option_changes = [c for c in detail["recentChanges"] if c.get("isOption")]
    assert len(option_changes) >= 1, "a newly-opened option should appear in recentChanges"


# ─── Fund flow + option rolls (Phase 3) ────────────────────────────────────


def test_fund_detail_computes_net_flow(tmp_path, monkeypatch):
    """get_fund_detail.flow reports net creation/redemption as a % of shares
    outstanding over the recent window — price-free, since scraper prices are
    unreliable."""
    from api import data as _data

    header = "ETF Ticker,Ticker,Name,Share Quantity,Weight,SharesOutstanding\n"
    (tmp_path / "holdings_2026-05-21.csv").write_text(
        header + "ULTY,AAPL,Apple,100,5.0,1100000\n"
    )
    (tmp_path / "holdings_2026-05-14.csv").write_text(
        header + "ULTY,AAPL,Apple,100,5.0,1000000\n"
    )
    monkeypatch.setattr(_data, "HISTORY_DIR", str(tmp_path))

    detail = _data.get_fund_detail("ULTY")
    assert detail is not None
    assert detail["flow"] is not None
    assert detail["flow"]["sharesDelta"] == 100000.0
    assert detail["flow"]["flowPct"] == 9.09  # 100k / 1.1M shares
    assert detail["flow"]["periodDays"] == 7


def test_fund_detail_flow_none_without_shares_outstanding(tmp_path, monkeypatch):
    """flow is None when the provider doesn't report shares outstanding —
    ARK and Avantis funds don't, and a missing value must not become a 0."""
    from api import data as _data

    header = "ETF Ticker,Ticker,Name,Share Quantity,Weight\n"
    (tmp_path / "holdings_2026-05-21.csv").write_text(header + "ARKK,TSLA,Tesla,100,9.0\n")
    (tmp_path / "holdings_2026-05-14.csv").write_text(header + "ARKK,TSLA,Tesla,100,9.0\n")
    monkeypatch.setattr(_data, "HISTORY_DIR", str(tmp_path))

    detail = _data.get_fund_detail("ARKK")
    assert detail is not None
    assert detail["flow"] is None


def test_fund_detail_detects_option_roll(tmp_path, monkeypatch):
    """An option contract closed + another opened on the same underlying and
    type surfaces as an optionRolls entry — a roll, not a buy + a sell."""
    from api import data as _data

    header = (
        "ETF Ticker,Ticker,Name,Share Quantity,Weight,Option_Type,"
        "Underlying_Ticker,Option_Strike,Option_Expiry\n"
    )
    # Today: NVDA C210 open. Yesterday: NVDA C200, now gone -> closed.
    (tmp_path / "holdings_2026-05-21.csv").write_text(
        header + "ULTY,NVDA 260529C00210000,NVDA Call,10,1.5,Call,NVDA,210,2026-05-29\n"
    )
    (tmp_path / "holdings_2026-05-20.csv").write_text(
        header + "ULTY,NVDA 260522C00200000,NVDA Call,10,1.5,Call,NVDA,200,2026-05-22\n"
    )
    monkeypatch.setattr(_data, "HISTORY_DIR", str(tmp_path))

    detail = _data.get_fund_detail("ULTY")
    assert detail is not None
    rolls = detail["optionRolls"]
    assert len(rolls) == 1
    assert rolls[0]["underlying"] == "NVDA"
    assert rolls[0]["optionType"] == "Call"
    assert rolls[0]["closed"][0]["strike"] == 200.0
    assert rolls[0]["opened"][0]["strike"] == 210.0


def _write_layering_fixture(hist_dir):
    """Three trading-day snapshots: AVLV holds TARGET the whole time (NOT new),
    while ARKK + AVUV enter on day 2 and CMAG enters on day 3 — three distinct
    families opening a brand-new TARGET position within the window."""
    header = "ETF Ticker,Ticker,Name,Sector,Weight,Share Quantity\n"
    # 2026-05-18 Mon: baseline — AVLV already holds TARGET; others hold filler.
    (hist_dir / "holdings_2026-05-18.csv").write_text(
        header
        + "AVLV,TARGET,Target Co,Tech,1.50,1000\n"
        + "ARKK,AAPL,Apple,Tech,2.00,500\n"
        + "AVUV,MSFT,Microsoft,Tech,1.00,300\n"
        + "CMAG,NVDA,Nvidia,Tech,3.00,200\n"
    )
    # 2026-05-19 Tue: ARKK + AVUV open brand-new TARGET positions.
    (hist_dir / "holdings_2026-05-19.csv").write_text(
        header
        + "AVLV,TARGET,Target Co,Tech,1.50,1000\n"
        + "ARKK,TARGET,Target Co,Tech,0.80,400\n"
        + "AVUV,TARGET,Target Co,Tech,0.50,250\n"
        + "CMAG,NVDA,Nvidia,Tech,3.00,200\n"
    )
    # 2026-05-20 Wed: CMAG (a third family) opens TARGET too.
    (hist_dir / "holdings_2026-05-20.csv").write_text(
        header
        + "AVLV,TARGET,Target Co,Tech,1.50,1000\n"
        + "ARKK,TARGET,Target Co,Tech,0.85,420\n"
        + "AVUV,TARGET,Target Co,Tech,0.55,260\n"
        + "CMAG,TARGET,Target Co,Tech,1.20,300\n"
    )


def test_layering_detects_cross_family_pileup(tmp_path, monkeypatch):
    from api import data as _data

    hist = tmp_path / "history"
    hist.mkdir()
    _write_layering_fixture(hist)
    monkeypatch.setattr(_data, "HISTORY_DIR", str(hist))

    res = _data.compute_layering_patterns(window_days=5, min_funds=3)
    by_ticker = {p["ticker"]: p for p in res["patterns"]}
    assert "TARGET" in by_ticker, f"TARGET not detected: {res}"

    p = by_ticker["TARGET"]
    entry_funds = [e["fund"] for e in p["entrySequence"]]
    # The three NEW entrants are counted; AVLV (held throughout) is NOT.
    assert set(entry_funds) == {"ARKK", "AVUV", "CMAG"}
    assert "AVLV" not in entry_funds
    assert p["distinctFunds"] == 3
    assert p["distinctProviders"] == 3  # ARK, Avantis, Corgi — cross-family
    # Entry sequence is ordered first-mover → last, with day-offsets from day 1.
    assert [e["entryDate"] for e in p["entrySequence"]] == sorted(e["entryDate"] for e in p["entrySequence"])
    assert min(e["daysIntoLayering"] for e in p["entrySequence"]) == 0


def test_layering_respects_min_funds(tmp_path, monkeypatch):
    from api import data as _data

    hist = tmp_path / "history"
    hist.mkdir()
    _write_layering_fixture(hist)
    monkeypatch.setattr(_data, "HISTORY_DIR", str(hist))

    # Only 3 funds ever enter TARGET; requiring 4 should yield no pattern for it.
    res = _data.compute_layering_patterns(window_days=5, min_funds=4)
    assert "TARGET" not in {p["ticker"] for p in res["patterns"]}


def test_snapshot_cache_reuses_payload_until_history_changes(data_with_fixtures, monkeypatch):
    """/signals and /briefing are cached per history-dir snapshot: repeat calls
    don't rebuild, and a new/rewritten holdings file triggers a rebuild while
    the stale payload keeps being served in the meantime."""
    builds = {"n": 0}
    orig = data_with_fixtures._build_full_payload

    def counting(*args, **kwargs):
        builds["n"] += 1
        return orig(*args, **kwargs)

    monkeypatch.setattr(data_with_fixtures, "_build_full_payload", counting)
    first = data_with_fixtures.get_full_payload()
    assert data_with_fixtures.get_full_payload() is first
    assert builds["n"] == 1

    # Simulate the scraper rewriting a file: the key changes.
    real_key = data_with_fixtures._snapshot_key()
    monkeypatch.setattr(data_with_fixtures, "_snapshot_key",
                        lambda: (real_key[0], real_key[1], real_key[2] + 1))
    stale = data_with_fixtures.get_full_payload()
    assert stale is first  # served immediately, rebuild runs in the background
    for t in __import__("threading").enumerate():
        if t is not __import__("threading").current_thread() and t.daemon:
            t.join(timeout=10)
    assert builds["n"] == 2
    assert data_with_fixtures.get_full_payload() is not first
