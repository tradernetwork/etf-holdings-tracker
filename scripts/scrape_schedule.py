#!/usr/bin/env python3
"""Cheap preflight: a scheduled run scrapes once per US session, after the swap.

GitHub starts scheduled runs hours late and by a different amount each day, so
the workflow requests a start every 30 minutes and this guard picks the one that
scrapes: the first to start inside a session's window with no snapshot committed
for that session yet.

Why the evening: issuers replace the day's file with the next session's between
about 18:10 and 19:45 New York. A scrape before that stores yesterday's close
under today's date, one after it stores today's close. Runs landed on both sides
(2026-11-12 before, 2026-11-11 and 11-16 after), so day-over-day diffs showed a
flat day followed by a double day.

The window for session D runs from D 19:50 New York until SWAP_START on the
next trading day: the issuers' files hold D's close the whole time, overnight
included. The first version of this guard only accepted starts between 19:50 and
New York midnight. From 2026-11-24 GitHub started every scheduled run either
before 19:50 or after midnight, so all of them skipped and no snapshot was
committed for 11-24, 11-25 or 11-26 while every run reported success. A start
after midnight now scrapes the session that just closed.

Inside the swap itself (SWAP_START to ROLLOVER on a trading day) a scheduled run
skips: some funds carry the old file and some the new one.

Exchange holidays are not sessions: on 2026-11-26 (Thanksgiving) the evening
run scrapes nothing new, because the last session is still 11-25.

Manual dispatch deliberately bypasses this guard, so a failed issuer can be
retried even when a carried-forward book has already been committed. It still
dates the snapshot with the session the files hold.
"""
import datetime
import os
from pathlib import Path
import sys
from zoneinfo import ZoneInfo

# Share the API's NYSE calendar (stdlib only, like scripts/check_freshness.py).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api.data import _is_trading_day  # noqa: E402

NEW_YORK = ZoneInfo('America/New_York')
# 94 of 150 funds carried the next session's file from 19:47 on; 88 did at 19:26.
ROLLOVER = datetime.time(19, 50)
# 0 of 148 had swapped at 18:12; 16 of 150 had by 18:26.
SWAP_START = datetime.time(18, 0)


def _trading(day: datetime.date) -> bool:
    return _is_trading_day(day.isoformat())


def in_swap(now: datetime.datetime) -> bool:
    """True while the issuers are mid-swap on a trading day: do not scrape."""
    local = now.astimezone(NEW_YORK)
    return _trading(local.date()) and SWAP_START <= local.time() < ROLLOVER


def after_rollover(now: datetime.datetime) -> bool:
    """True on a trading day once the issuers' files for the next session are out."""
    local = now.astimezone(NEW_YORK)
    return _trading(local.date()) and local.time() >= ROLLOVER


def snapshot_day(now: datetime.datetime) -> datetime.date:
    """The last session whose close the issuers' files hold at `now`.

    That is today once today's rollover has passed, otherwise the trading day
    before today, so a run GitHub delays past New York midnight still writes the
    session that just closed.
    """
    local = now.astimezone(NEW_YORK)
    day = local.date()
    if not after_rollover(now):
        day -= datetime.timedelta(days=1)
        while not _trading(day):
            day -= datetime.timedelta(days=1)
    return day


def should_scrape(event: str, history: Path, today: datetime.date, rolled: bool = True) -> bool:
    """`rolled` is False only inside the swap window (see in_swap)."""
    if event != 'schedule':
        return True
    if not rolled:
        return False
    snapshot = history / f'holdings_{today.isoformat()}.csv'
    return not snapshot.is_file() or snapshot.stat().st_size == 0


if __name__ == '__main__':
    now = datetime.datetime.now(datetime.timezone.utc)
    day = snapshot_day(now)
    swapping = in_swap(now)
    run = should_scrape(os.environ.get('EVENT_NAME', 'schedule'),
                        Path('etf-dashboard/public/data/history'), day, not swapping)
    if run:
        reason = 'scrape needed'
    elif swapping:
        reason = f'issuers mid-swap ({SWAP_START:%H:%M}-{ROLLOVER:%H:%M} New York); skip'
    else:
        reason = 'snapshot already committed; skip'
    print(f'{day}: {reason}')
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write(f'run={str(run).lower()}\nsnapshot_date={day.isoformat()}\n')
