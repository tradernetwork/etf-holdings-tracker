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
    monkeypatch.setattr(data, "snapshot_signature", lambda: ("sig", sig["v"]))

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
    monkeypatch.setattr(data, "prewarm_snapshot_caches", lambda: warmed.append(state["sig"]))
    monkeypatch.setattr(data, "snapshot_signature", lambda: state["sig"])
    p = data.SnapshotPrewarmer()
    p._tick(); p._tick()
    assert warmed == [("a",)]                                          # unchanged signature: no rework
    state["sig"] = ("b",)
    p._tick()
    assert warmed == [("a",), ("b",)]                                  # data-only sync: re-warmed, no restart


def test_prewarmer_never_raises(monkeypatch):
    errors = []
    monkeypatch.setattr(data, "snapshot_signature", lambda: ("x",))
    monkeypatch.setattr(data, "prewarm_snapshot_caches", lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    p = data.SnapshotPrewarmer(on_error=errors.append)
    p._tick()
    assert len(errors) == 1
