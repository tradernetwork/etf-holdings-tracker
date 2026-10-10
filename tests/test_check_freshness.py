import datetime
import importlib.util
import io
import json
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "check_freshness", Path(__file__).resolve().parent.parent / "scripts" / "check_freshness.py")
cf = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cf)

ASOF = datetime.date(2026, 10, 9)


def _fake_urlopen(funds, held):
    def _open(url, timeout=0):
        if url.endswith("/api/v1/funds"):
            return io.StringIO(json.dumps({"funds": funds}))
        return io.StringIO(json.dumps({"holdingsDate": held[url.rsplit("/", 1)[1]]}))
    return _open


def test_fund_stuck_for_two_weeks_is_reported(monkeypatch):
    funds = [{"fund": "ARKK", "stale": True}, {"fund": "AVUV", "stale": False}]
    monkeypatch.setattr(cf.urllib.request, "urlopen", _fake_urlopen(funds, {"ARKK": "2026-09-25"}))
    out = cf.stale_funds("http://x", ASOF)
    assert [(n, d) for n, d, _ in out] == [("ARKK", "2026-09-25")]
    assert out[0][2] == 10


def test_briefly_stale_fund_is_tolerated(monkeypatch):
    funds = [{"fund": "ARKK", "stale": True}]
    monkeypatch.setattr(cf.urllib.request, "urlopen", _fake_urlopen(funds, {"ARKK": "2026-10-08"}))
    assert cf.stale_funds("http://x", ASOF) == []
