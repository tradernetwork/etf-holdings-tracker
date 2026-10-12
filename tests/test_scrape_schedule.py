import datetime as dt
import pytest

from scripts import check_freshness as freshness
from scripts.scrape_schedule import should_scrape, snapshot_day


def test_scheduled_backup_skips_committed_snapshot_but_manual_can_force(tmp_path):
    today = dt.date(2026, 10, 12)
    assert should_scrape('schedule', tmp_path, today)
    (tmp_path / 'holdings_2026-10-12.csv').write_text('ETF Ticker,Ticker\nARKK,TER\n')
    assert not should_scrape('schedule', tmp_path, today)
    assert should_scrape('workflow_dispatch', tmp_path, today)


def test_empty_snapshot_does_not_suppress_recovery(tmp_path):
    (tmp_path / 'holdings_2026-10-12.csv').touch()
    assert should_scrape('schedule', tmp_path, dt.date(2026, 10, 12))


def test_deadline_catches_missing_monday_without_morning_false_alarm():
    friday = dt.date(2026, 10, 9)
    assert freshness.required_snapshot_date(dt.datetime(2026, 10, 12, 20, 59, tzinfo=dt.timezone.utc)) is None
    deadline = dt.datetime(2026, 10, 12, 21, tzinfo=dt.timezone.utc)
    assert freshness.required_snapshot_date(deadline) == dt.date(2026, 10, 12)
    assert friday < freshness.required_snapshot_date(deadline)


def test_late_canary_still_checks_previous_days_deadline():
    delayed = dt.datetime(2026, 10, 13, 3, tzinfo=dt.timezone.utc)
    assert freshness.required_snapshot_date(delayed, require_due=True) == dt.date(2026, 10, 12)


def test_weekends_and_market_holidays_use_last_due_session():
    monday_morning = dt.datetime(2026, 10, 12, 8, tzinfo=dt.timezone.utc)
    assert freshness.required_snapshot_date(monday_morning, require_due=True) == dt.date(2026, 10, 9)
    thanksgiving = dt.datetime(2026, 11, 26, 22, tzinfo=dt.timezone.utc)
    assert freshness.required_snapshot_date(thanksgiving) is None
    assert freshness.required_snapshot_date(thanksgiving, require_due=True) == dt.date(2026, 11, 25)


@pytest.mark.parametrize('asof,expected', [('2026-10-09', 1), ('2026-10-12', 0)])
def test_deadline_check_fails_live_canary_for_missing_day(monkeypatch, asof, expected):
    import io
    import json
    clock = dt.datetime

    class DeadlineClock(clock):
        @classmethod
        def now(cls, tz=None):
            return clock(2026, 10, 12, 21, 17, tzinfo=dt.timezone.utc)

    monkeypatch.setattr(freshness.datetime, 'datetime', DeadlineClock)
    monkeypatch.setattr(freshness, 'API_BASE', 'https://example.test')
    monkeypatch.setattr(freshness.urllib.request, 'urlopen', lambda url, **kw: io.BytesIO(
        json.dumps({'asOfDate': asof} if str(url).endswith('/health') else {'funds': []}).encode()))
    assert freshness.main() == expected


def test_backup_after_utc_midnight_does_not_poison_next_days_guard():
    delayed = dt.datetime(2026, 10, 13, 2, 37, tzinfo=dt.timezone.utc)
    assert snapshot_day(delayed) == dt.date(2026, 10, 12)
    assert snapshot_day(dt.datetime(2026, 10, 13, 18, 17, tzinfo=dt.timezone.utc)) == dt.date(2026, 10, 13)
