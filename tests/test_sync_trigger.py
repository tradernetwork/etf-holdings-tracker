"""Guard: every file the Dockerfile COPYs from the repo must trigger a rebuild in sync_data.sh."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _copy_sources():
    srcs = []
    for line in (ROOT / "Dockerfile").read_text().splitlines():
        parts = line.split()
        if parts and parts[0].upper() == "COPY" and not any(p.startswith("--from") for p in parts):
            srcs.extend(p for p in parts[1:-1] if not p.startswith("--"))
    return srcs


def _rebuild_regex():
    m = re.search(r"^REBUILD_RE='([^']+)'", (ROOT / "sync_data.sh").read_text(), re.M)
    assert m, "REBUILD_RE not found in sync_data.sh"
    return re.compile(m.group(1))


def test_dockerfile_has_copy_sources():
    assert _copy_sources()


def test_every_copy_source_triggers_rebuild():
    rx = _rebuild_regex()
    missing = [s for s in _copy_sources() if not rx.match(s)]
    assert not missing, f"Dockerfile COPY sources not matched by REBUILD_RE: {missing}"


def test_dockerfile_and_compose_trigger_rebuild():
    rx = _rebuild_regex()
    assert rx.match("Dockerfile") and rx.match("docker-compose.yml")
