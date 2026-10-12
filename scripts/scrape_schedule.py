#!/usr/bin/env python3
"""Cheap preflight: a scheduled retry only fills a missing US-session snapshot.

Manual dispatch deliberately bypasses this guard, so a failed issuer can be
retried even when a carried-forward book has already been committed today.
"""
import datetime
import os
from pathlib import Path
from zoneinfo import ZoneInfo


def snapshot_day(now: datetime.datetime) -> datetime.date:
    """Use the US session's date when a delayed run crosses UTC midnight."""
    return now.astimezone(ZoneInfo('America/New_York')).date()


def should_scrape(event: str, history: Path, today: datetime.date) -> bool:
    snapshot = history / f'holdings_{today.isoformat()}.csv'
    return event != 'schedule' or not snapshot.is_file() or snapshot.stat().st_size == 0


if __name__ == '__main__':
    day = snapshot_day(datetime.datetime.now(datetime.timezone.utc))
    run = should_scrape(os.environ.get('EVENT_NAME', 'schedule'),
                        Path('etf-dashboard/public/data/history'), day)
    print(f'{day}: {"scrape needed" if run else "snapshot already committed; skip"}')
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write(f'run={str(run).lower()}\nsnapshot_date={day.isoformat()}\n')
