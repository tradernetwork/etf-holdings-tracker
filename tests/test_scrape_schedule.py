import datetime as dt
import pytest

from scripts import check_freshness as freshness
from scripts.scrape_schedule import after_rollover, in_swap, should_scrape, snapshot_day


def test_scheduled_backup_skips_committed_snapshot_but_manual_can_force(tmp_path):
    today = dt.date(2026, 10, 12)
    assert should_scrape('schedule', tmp_path, today)
    (tmp_path / 'holdings_2026-10-12.csv').write_text('ETF Ticker,Ticker\nARKK,TER\n')
    assert not should_scrape('schedule', tmp_path, today)
    assert should_scrape('workflow_dispatch', tmp_path, today)


def test_scheduled_run_waits_for_the_issuer_rollover(tmp_path):
    today = dt.date(2026, 11, 16)
    assert not should_scrape('schedule', tmp_path, today, rolled=False)
    assert should_scrape('schedule', tmp_path, today, rolled=True)
    assert should_scrape('workflow_dispatch', tmp_path, today, rolled=False)


def test_rollover_is_new_york_evening_in_both_offsets():
    utc = dt.timezone.utc
    # EST: 19:50 New York is 00:50 UTC the next day.
    assert not after_rollover(dt.datetime(2026, 11, 17, 0, 49, tzinfo=utc))
    assert after_rollover(dt.datetime(2026, 11, 17, 0, 50, tzinfo=utc))
    # EDT: 19:50 New York is 23:50 UTC.
    assert not after_rollover(dt.datetime(2026, 10, 12, 23, 49, tzinfo=utc))
    assert after_rollover(dt.datetime(2026, 10, 12, 23, 50, tzinfo=utc))
    # Past New York midnight today's rollover has not happened yet.
    assert not after_rollover(dt.datetime(2026, 11, 17, 5, 30, tzinfo=utc))
    assert not after_rollover(dt.datetime(2026, 11, 16, 18, 17, tzinfo=utc))
    # A holiday evening is not a rollover: there was no session.
    assert not after_rollover(dt.datetime(2026, 11, 27, 1, 0, tzinfo=utc))


def test_empty_snapshot_does_not_suppress_recovery(tmp_path):
    (tmp_path / 'holdings_2026-10-12.csv').touch()
    assert should_scrape('schedule', tmp_path, dt.date(2026, 10, 12))


def test_deadline_catches_missing_monday_without_morning_false_alarm():
    friday = dt.date(2026, 10, 9)
    assert freshness.required_snapshot_date(dt.datetime(2026, 10, 13, 3, 59, tzinfo=dt.timezone.utc)) is None
    deadline = dt.datetime(2026, 10, 13, 4, tzinfo=dt.timezone.utc)
    assert freshness.required_snapshot_date(deadline) == dt.date(2026, 10, 12)
    assert friday < freshness.required_snapshot_date(deadline)


def test_late_canary_still_checks_previous_days_deadline():
    delayed = dt.datetime(2026, 10, 13, 10, tzinfo=dt.timezone.utc)
    assert freshness.required_snapshot_date(delayed, require_due=True) == dt.date(2026, 10, 12)
    # Before Monday's deadline the last due session is still Friday.
    early = dt.datetime(2026, 10, 13, 3, tzinfo=dt.timezone.utc)
    assert freshness.required_snapshot_date(early, require_due=True) == dt.date(2026, 10, 9)


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
            return clock(2026, 10, 13, 4, 17, tzinfo=dt.timezone.utc)

    monkeypatch.setattr(freshness.datetime, 'datetime', DeadlineClock)
    monkeypatch.setattr(freshness, 'API_BASE', 'https://example.test')
    monkeypatch.setattr(freshness.urllib.request, 'urlopen', lambda url, **kw: io.BytesIO(
        json.dumps({'asOfDate': asof} if str(url).endswith('/health') else {'funds': []}).encode()))
    assert freshness.main() == expected


def test_backup_after_utc_midnight_does_not_poison_next_days_guard():
    delayed = dt.datetime(2026, 10, 13, 2, 37, tzinfo=dt.timezone.utc)
    assert snapshot_day(delayed) == dt.date(2026, 10, 12)
    # Before Tuesday's swap the files still hold Monday's close.
    assert snapshot_day(dt.datetime(2026, 10, 13, 18, 17, tzinfo=dt.timezone.utc)) == dt.date(2026, 10, 12)


def test_run_delayed_past_new_york_midnight_scrapes_the_session_that_closed(tmp_path):
    # 2026-11-24 to 11-26: GitHub started every scheduled run before 19:50 or
    # after midnight New York, the guard skipped all of them, and three sessions
    # were never committed. These are the real start times from those nights.
    utc = dt.timezone.utc
    after_midnight = [
        (dt.datetime(2026, 11, 25, 5, 41, tzinfo=utc), dt.date(2026, 11, 24)),
        (dt.datetime(2026, 11, 25, 8, 43, tzinfo=utc), dt.date(2026, 11, 24)),
        (dt.datetime(2026, 11, 26, 5, 6, tzinfo=utc), dt.date(2026, 11, 25)),
        # Thanksgiving (11-26) had no session: Friday morning still means 11-25.
        (dt.datetime(2026, 11, 27, 5, 4, tzinfo=utc), dt.date(2026, 11, 25)),
        (dt.datetime(2026, 11, 27, 8, 43, tzinfo=utc), dt.date(2026, 11, 25)),
    ]
    for now, session in after_midnight:
        assert snapshot_day(now) == session, now
        assert not in_swap(now), now
        assert should_scrape('schedule', tmp_path, snapshot_day(now), not in_swap(now)), now


def test_weekend_and_monday_morning_belong_to_friday():
    utc = dt.timezone.utc
    assert snapshot_day(dt.datetime(2026, 11, 21, 5, 0, tzinfo=utc)) == dt.date(2026, 11, 20)
    assert snapshot_day(dt.datetime(2026, 11, 23, 14, 17, tzinfo=utc)) == dt.date(2026, 11, 20)


def test_swap_window_skips_and_closes_at_rollover():
    utc = dt.timezone.utc
    # 2026-11-24 23:29 UTC = 18:29 New York: mid-swap, skip.
    assert in_swap(dt.datetime(2026, 11, 24, 23, 29, tzinfo=utc))
    # 17:59 New York: files still hold the previous close.
    assert not in_swap(dt.datetime(2026, 11, 24, 22, 59, tzinfo=utc))
    assert snapshot_day(dt.datetime(2026, 11, 24, 22, 59, tzinfo=utc)) == dt.date(2026, 11, 23)
    # 19:50 New York: the swap is over and the snapshot is today's.
    rolled = dt.datetime(2026, 11, 25, 0, 50, tzinfo=utc)
    assert not in_swap(rolled)
    assert snapshot_day(rolled) == dt.date(2026, 11, 24)
    # No swap on a holiday.
    assert not in_swap(dt.datetime(2026, 11, 26, 23, 30, tzinfo=utc))


def test_committed_session_is_not_scraped_twice_overnight(tmp_path):
    (tmp_path / 'holdings_2026-11-24.csv').write_text('ETF Ticker,Ticker\nARKK,TER\n')
    late = dt.datetime(2026, 11, 25, 5, 41, tzinfo=dt.timezone.utc)
    assert not should_scrape('schedule', tmp_path, snapshot_day(late), not in_swap(late))
