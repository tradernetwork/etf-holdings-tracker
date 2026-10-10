"""
The per-snapshot result memo (api/data.py `_memoize_per_snapshot`) must be a pure
speed-up: byte-identical output, invalidated by new or rewritten snapshots,
bounded, and safe against callers that mutate what they get back.
"""

import json
import os
import shutil

import pytest

from api import data

ENDPOINTS = ("get_full_payload", "get_briefing", "get_signals")
CATEGORIES = (None, "active-equity", "option-income")


@pytest.fixture(autouse=True)
def _fresh_memo():
    data.clear_result_memo()
    yield
    data.clear_result_memo()


def _dump(v) -> str:
    return json.dumps(v)  # no sort_keys: key ORDER must be identical too


@pytest.mark.parametrize("name", ENDPOINTS)
@pytest.mark.parametrize("category", CATEGORIES)
def test_memoized_output_is_byte_identical_to_uncached(data_with_fixtures, name, category):
    fn = getattr(data_with_fixtures, name)
    uncached = _dump(fn.__wrapped__(category=category))
    first = _dump(fn(category=category))    # memo miss: computes
    second = _dump(fn(category=category))   # memo hit: served from cache
    assert first == uncached
    assert second == uncached


@pytest.mark.parametrize("name", ("get_full_payload", "get_briefing"))
def test_byte_identical_on_the_real_history(name):
    """The two slow endpoints, on the committed 160+ file history."""
    if len(data.get_available_dates()) < 3:
        pytest.skip("no real history checked in")
    fn = getattr(data, name)
    uncached = _dump(fn.__wrapped__(category="active-equity"))
    assert _dump(fn(category="active-equity")) == uncached
    assert _dump(fn(category="active-equity")) == uncached


def test_hit_skips_the_computation(data_with_fixtures, monkeypatch):
    calls = []
    real = data_with_fixtures._signals_from
    monkeypatch.setattr(data_with_fixtures, "_signals_from", lambda *a, **k: (calls.append(1), real(*a, **k))[1])
    data_with_fixtures.get_signals(category=None)
    n = len(calls)
    assert n >= 1
    data_with_fixtures.get_signals(category=None)
    assert len(calls) == n                      # no recompute
    data_with_fixtures.get_signals(category="active-equity")
    assert len(calls) > n                       # a different param is its own entry


def test_callers_may_mutate_results_without_poisoning_the_memo(data_with_fixtures):
    a = data_with_fixtures.get_full_payload(category=None)
    a["signals"]["buying"].clear()
    a["asOfDate"] = "tampered"
    b = data_with_fixtures.get_full_payload(category=None)
    assert b["asOfDate"] != "tampered"
    assert b == data_with_fixtures.get_full_payload.__wrapped__(category=None)


@pytest.fixture
def writable_history(tmp_path, fixture_dir, monkeypatch):
    for f in os.listdir(fixture_dir):
        if f.startswith("holdings_") and f.endswith(".csv"):
            shutil.copy(os.path.join(fixture_dir, f), tmp_path / f)
    monkeypatch.setattr(data, "HISTORY_DIR", str(tmp_path))
    return tmp_path


def test_a_new_snapshot_invalidates_the_memo(writable_history):
    before = data.get_full_payload(category=None)
    assert data.get_full_payload(category=None) == before            # cached
    newest = sorted(f for f in os.listdir(writable_history) if f.startswith("holdings_"))[-1]
    shutil.copy(writable_history / newest, writable_history / "holdings_2026-05-19.csv")
    after = data.get_full_payload(category=None)
    assert after["asOfDate"] == "2026-05-19"
    assert after["asOfDate"] != before["asOfDate"]


def test_a_same_day_rewrite_invalidates_the_memo(writable_history):
    sig_before = data.snapshot_signature()
    before = data.get_signals(category=None)
    newest = writable_history / sorted(f for f in os.listdir(writable_history) if f.startswith("holdings_"))[-1]
    lines = newest.read_text().splitlines()
    newest.write_text("\n".join(lines[:-3]) + "\n")                   # a corrected, shorter re-scrape
    assert data.snapshot_signature() != sig_before
    after = data.get_signals(category=None)
    assert _dump(after) == _dump(data.get_signals.__wrapped__(category=None))
    del before  # content may legitimately coincide; the assertion above proves a fresh recompute


def test_memo_is_bounded_and_drops_stale_signatures(monkeypatch):
    sig = {"v": 1}
    monkeypatch.setattr(data, "snapshot_signature", lambda depth=data._SIGNATURE_FILES: ("sig", sig["v"]))

    @data._memoize_per_snapshot
    def f(*, n):
        return {"n": n}

    for i in range(data._MEMO_MAX + 10):
        f(n=i)
    assert len(data._memo) == data._MEMO_MAX
    sig["v"] = 2
    f(n=0)
    assert len(data._memo) == 1                                        # every v1 entry freed


def test_prewarmer_warms_once_per_signature(monkeypatch):
    warmed = []
    state = {"sig": ("a",)}
    monkeypatch.setattr(data, "prewarm_snapshot_caches", lambda *a, **k: warmed.append(state["sig"]))
    monkeypatch.setattr(data, "snapshot_signature", lambda depth=data._SIGNATURE_FILES: state["sig"])
    p = data.SnapshotPrewarmer()
    p._tick(); p._tick()
    assert warmed == [("a",)]                                          # unchanged signature: no rework
    state["sig"] = ("b",)
    p._tick()
    assert warmed == [("a",), ("b",)]                                  # data-only sync: re-warmed, no restart


def test_prewarmer_never_raises(monkeypatch):
    errors = []
    monkeypatch.setattr(data, "snapshot_signature", lambda depth=data._SIGNATURE_FILES: ("x",))
    monkeypatch.setattr(data, "prewarm_snapshot_caches", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    p = data.SnapshotPrewarmer(on_error=errors.append)
    p._tick()
    assert len(errors) == 1


# ─── Parameter-aware signature (Codex's repro) ───────────────────────────────

def _weekdays(n, start="2026-07-06"):   # 20 weekdays with no market holiday
    from datetime import date, timedelta
    d, out = date.fromisoformat(start), []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


@pytest.fixture
def deep_history(tmp_path, monkeypatch):
    """20 daily snapshots in which ARKK/TSLA gains weight and shares EVERY day."""
    days = _weekdays(20)
    for i, d in enumerate(days):
        (tmp_path / f"holdings_{d}.csv").write_text(
            "ETF Ticker,Ticker,Name,Sector,Weight,Share Quantity,Option_Type,Underlying_Ticker,Option_Strike,Option_Expiry\n"
            f"ARKK,TSLA,Tesla Inc,Consumer Discretionary,{10 + i * 0.5},{1000 + i * 100},,,,\n"
            f"ARKK,NVDA,NVIDIA Corp,Technology,{20 - i * 0.5},{5000 - i * 100},,,,\n"
        )
    monkeypatch.setattr(data, "HISTORY_DIR", str(tmp_path))
    return tmp_path, days


def test_signature_depth_follows_the_calls_own_parameters(deep_history):
    _, days = deep_history
    assert len(data.snapshot_signature(12)[2]) == 12
    assert len(data.snapshot_signature(22)[2]) == 20          # capped by what exists
    assert data.snapshot_signature(12) != data.snapshot_signature(22)


def test_editing_a_file_beyond_the_default_window_invalidates_a_deeper_streak_call(deep_history):
    """Codex's repro: 20 snapshots, edit the 14th-newest in place, max_days=20."""
    tmp_path, days = deep_history
    newest_first = list(reversed(days))
    fourteenth = tmp_path / f"holdings_{newest_first[13]}.csv"

    before = data._compute_streaks(max_days=20)
    assert data._compute_streaks(max_days=20) == before                      # served from the memo
    assert before == data._compute_streaks.__wrapped__(max_days=20)

    # Break the run at that day (flat weight and shares) without touching the newest 12 files.
    fourteenth.write_text(
        "ETF Ticker,Ticker,Name,Sector,Weight,Share Quantity,Option_Type,Underlying_Ticker,Option_Strike,Option_Expiry\n"
        "ARKK,TSLA,Tesla Inc,Consumer Discretionary,99,1,,,,\n"
        "ARKK,NVDA,NVIDIA Corp,Technology,1,1,,,,\n"
    )
    uncached = data._compute_streaks.__wrapped__(max_days=20)
    assert uncached != before                                                # the edit really changes the answer
    assert data._compute_streaks(max_days=20) == uncached                    # and the memo noticed it


def test_default_depth_calls_are_unaffected_by_edits_beyond_their_window(deep_history):
    """max_days=10 reads 10 files (signature covers 12), so a 14th-file edit may keep the entry."""
    tmp_path, days = deep_history
    before = data._compute_streaks()
    (tmp_path / f"holdings_{list(reversed(days))[13]}.csv").write_text("ETF Ticker,Ticker,Weight\nARKK,TSLA,1\n")
    assert data._compute_streaks() == before == data._compute_streaks.__wrapped__()


def test_a_deep_call_does_not_evict_default_depth_entries_as_stale(deep_history):
    data._compute_streaks()                        # depth 12 entry
    data._compute_streaks(max_days=20)             # depth 22 entry, different signature shape
    keys = [k for k in data._memo if k[0] == "_compute_streaks"]
    assert len(keys) == 2


# ─── Clean prewarmer shutdown ────────────────────────────────────────────────

def test_stop_during_an_active_warm_returns_in_time_and_the_thread_dies(monkeypatch):
    import threading
    import time
    started, finished_units = threading.Event(), []

    def slow(**kw):
        started.set()
        time.sleep(0.2)
        finished_units.append(kw)

    for name in ENDPOINTS:
        monkeypatch.setattr(data, name, slow)
    monkeypatch.setattr(data, "snapshot_signature", lambda depth=data._SIGNATURE_FILES: ("sig",))
    p = data.SnapshotPrewarmer(interval_s=60)
    p.start()
    assert started.wait(5)                          # a warm is in flight
    t0 = time.monotonic()
    assert p.stop(timeout=5) is True
    assert time.monotonic() - t0 < 2.0
    assert not p._thread.is_alive()
    assert len(finished_units) < 6                  # it did NOT run every remaining unit after stop()
    assert p._last is None                          # an interrupted warm is not recorded as complete


def test_stop_without_start_is_harmless():
    assert data.SnapshotPrewarmer().stop() is True


def test_prewarm_checks_stop_between_units(monkeypatch):
    ran = []
    for name in ENDPOINTS:
        monkeypatch.setattr(data, name, lambda **kw: ran.append(kw))
    assert data.prewarm_snapshot_caches(lambda: len(ran) >= 2) is False
    assert len(ran) == 2


def test_lifespan_stops_the_prewarmer_even_when_the_app_body_raises(monkeypatch):
    import asyncio
    from api import server
    stops = []

    class Fake:
        def __init__(self, *a, **k): pass
        def start(self): pass
        def stop(self, timeout=10.0): stops.append(timeout); return True

    monkeypatch.setattr(server.data, "SnapshotPrewarmer", Fake)
    monkeypatch.setenv("TT_PREWARM", "1")

    async def run():
        try:
            async with server.lifespan(server.app):
                raise RuntimeError("boom")
        except BaseException:   # the MCP sub-app's task group wraps it in an ExceptionGroup
            pass

    asyncio.run(run())
    assert stops == [10.0]
