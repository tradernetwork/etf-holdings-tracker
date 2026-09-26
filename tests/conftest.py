"""
Shared pytest fixtures. The data-layer tests need `api.data.HISTORY_DIR`
pointed at our local `tests/fixtures/` directory so we can run them without
needing real production CSVs.
"""

import os
import sys

import pytest

# Make `import api.data` work when running pytest from repo root.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture
def fixture_dir() -> str:
    """Absolute path to tests/fixtures/."""
    return os.path.join(os.path.dirname(__file__), "fixtures")


@pytest.fixture
def data_with_fixtures(fixture_dir, monkeypatch):
    """Import api.data with HISTORY_DIR pointed at fixtures/. Returns the module."""
    from api import data as _data
    monkeypatch.setattr(_data, "HISTORY_DIR", fixture_dir)
    # The snapshot cache would otherwise hand one test the payload another
    # test built (and hide call-count regressions like review #14's).
    _data.clear_snapshot_cache()
    return _data
