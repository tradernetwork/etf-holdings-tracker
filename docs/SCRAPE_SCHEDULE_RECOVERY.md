# Missing scheduled scrape: October 12, 2026

## What the evidence says

- GitHub reports `scrape.yml` state **active** (workflow ID 238316184).
- The latest 30 `schedule` runs cover every weekday from August 31 through
  October 9. No weekday was skipped in that interval; October 5 ran but failed.
  Recent starts: October 6 18:16, October 7 18:48, October 8 18:46,
  October 9 18:16 UTC, despite a configured 12:00 UTC trigger.
- No scheduled run existed for October 12 at investigation time. Manual run
  [38304673872](https://github.com/tradernetwork/etf-holdings-tracker/actions/runs/38304673872)
  started at 20:30:32 UTC and succeeded.
- No October 12 edit changed `scrape.yml`. Its latest substantive change was
  July 22, making the CBOE scanner non-fatal. No name/trigger/YAML regression
  explains the absence.
- GitHub documents that schedule events can be delayed and even dropped during
  high load, particularly at the start of the hour:
  [official scheduling documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
  A dropped/delayed scheduler event is the likely explanation, not a proven
  internal GitHub root cause. There is no failed run or scheduler diagnostic
  that distinguishes a permanently dropped event from a very late one.

## Small recovery and alarm, no new secrets

The primary now requests **18:17 UTC** and the backup **20:37 UTC**, weekdays.
Both avoid the busy hour boundary. The primary deliberately preserves the
observed ~18:00 collection window: moving an effective afternoon scrape to
12:00 could capture older provider files. October 9's committed snapshot had
89 funds with Source_Date October 9, three October 8, and six frozen September
25 ARK books. The October 12 manual snapshot has all 98 dated October 12.
Those observations do NOT prove that a noon scrape would capture the same data.

A workflow concurrency group prevents overlapping scrapes from racing the
commit; it does not cancel an active run. A cheap preflight checks current main
AFTER entering that group, rather than the event-time commit. Scheduled runs
skip the expensive scrape if the session's nonempty snapshot already exists;
manual dispatch bypasses the check, allowing issuer retries on an existing day.
The archive and commit use the SAME preflight date. It is New York's date, so
Monday's delayed backup starting Tuesday 02:37 UTC still writes Monday, rather
than poisoning Tuesday's guard with an overnight file. Delays extending into a
new New York calendar day cannot be assigned to the original nominal cron date
because GitHub does not supply that nominal date; the deadline canary is the
alarm for that case.

The canary retains its relaxed morning check, moves that minute to 13:19, and
adds one **21:17 UTC** check. After 21:00 on a market day, serving yesterday's
snapshot is a failure even though the old one-business-day tolerance accepted
it. The late workflow sets `REQUIRE_DAILY_SNAPSHOT=1`: if GitHub delivers it
past midnight, it still checks the most recent elapsed 21:00 deadline. NYSE
holidays/weekends use the API's shared calendar and do not create false alarms.
The single late workflow fails loudly with a `MISSED DAILY SNAPSHOT` annotation;
notification email follows the repository user's existing Actions notification
settings. No outbound email service or new notification credentials are added.
Existing morning freeze/per-fund/code checks remain intact.

## Limits and operational response

**This reduces risk; it is not an independent scheduling guarantee.** The
primary, backup and canary still depend on GitHub's scheduler. Any of them can
be delayed or dropped, and a delayed backup can arrive after the alarm. If all
are dropped, GitHub cannot announce its own absence.

A truly independent recovery path would need a Vultr timer and a narrowly
scoped Actions-dispatch credential on the box (rotation, storage and dispatch
rate limits), or an external monitor. This PR avoids that new operational
surface. If missed schedules recur, use that independent timer/monitor next.

On the deadline alarm, inspect scrape runs; dispatch `scrape.yml` manually if
missing/failed. If a current committed snapshot exists but the API is behind,
inspect `sync_data.sh` instead. A committed daily snapshot is not proof every
issuer refreshed; the existing per-fund freshness alarm remains necessary.

Tests cover backup/manual behavior, empty files, Monday's deadline, delayed
canary execution, weekends/holidays, UTC-midnight dating, and live-canary exit
status for stale/current data. YAML parsing and the full Python suite validate
this change; the workflow is not dispatched from this PR.
