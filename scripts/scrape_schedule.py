#!/usr/bin/env python3
"""Cheap preflight: a scheduled run scrapes once per US session, in the evening.

GitHub starts scheduled runs hours late and by a different amount each day, so
the workflow requests a start every 30 minutes and this guard picks the one that
scrapes: the first to start at or after ROLLOVER (New York time) with no
snapshot committed for the session yet.

Why the evening: issuers replace the day's file with the next session's between
about 18:40 and 19:45 New York. A scrape before that stores yesterday's close
under today's date, one after it stores today's close. Runs landed on both sides
(2026-11-12 before, 2026-11-11 and 11-16 after), so day-over-day diffs showed a
flat day followed by a double day.

Manual dispatch deliberately bypasses this guard, so a failed issuer can be
retried even when a carried-forward book has already been committed today.
"""
import datetime
import os
from pathlib import Path
from zoneinfo import ZoneInfo


NEW_YORK = ZoneInfo('America/New_York')
# 94 of 150 funds carried the next session's file from 19:47 on; 88 did at 19:26.
ROLLOVER = datetime.time(19, 50)


def after_rollover(now: datetime.datetime) -> bool:
    """True once the issuers' files for the next session are out."""
    return now.astimezone(NEW_YORK).time() >= ROLLOVER


def snapshot_day(now: datetime.datetime) -> datetime.date:
    """Use the US session's date when a delayed run crosses UTC midnight."""
    return now.astimezone(NEW_YORK).date()


def should_scrape(event: str, history: Path, today: datetime.date, rolled: bool = True) -> bool:
    if event != 'schedule':
        return True
    if not rolled:
        return False
    snapshot = history / f'holdings_{today.isoformat()}.csv'
    return not snapshot.is_file() or snapshot.stat().st_size == 0


if __name__ == '__main__':
    now = datetime.datetime.now(datetime.timezone.utc)
    day = snapshot_day(now)
    rolled = after_rollover(now)
    run = should_scrape(os.environ.get('EVENT_NAME', 'schedule'),
                        Path('etf-dashboard/public/data/history'), day, rolled)
    if run:
        reason = 'scrape needed'
    elif not rolled:
        reason = f'before {ROLLOVER:%H:%M} New York; skip'
    else:
        reason = 'snapshot already committed; skip'
    print(f'{day}: {reason}')
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write(f'run={str(run).lower()}\nsnapshot_date={day.isoformat()}\n')
