#!/usr/bin/env python3
"""
Dry run of the watchlist digest on REAL history. Sends nothing, writes nothing.

Builds exactly what api/notification_job.py would freeze for a synthetic device (the same
build_events + build_digest the worker calls), for one or more follow lists, and prints the
notification title/body, the push payload and the private digest detail. It never opens the
notifications database and never contacts Expo: the delivery functions are replaced with
tripwires that raise, so even a bug cannot send.

    python3 scripts/notifications_dry_run.py                       # default demo follows
    python3 scripts/notifications_dry_run.py --follow fund:MSTY ticker:NVDA
    python3 scripts/notifications_dry_run.py --simulate-monday     # treat the newest weekend file as the next market day
    python3 scripts/notifications_dry_run.py --history /path/to/history --out /tmp/dryrun.md

--simulate-monday exercises the catch-up path (a fund returning from carried-forward rows) without
touching the repo's history: it builds a temp directory of symlinks.
"""
import argparse
import os
import shutil
import sys
import tempfile
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

from api import data, notification_job as job, push_delivery  # noqa: E402


def _tripwire(*a, **k):
    raise RuntimeError('dry run: delivery is disabled')


push_delivery.send_expo = _tripwire
push_delivery.get_receipts = _tripwire

DEFAULT_SETS = {
    'Fund + ticker follower (MSTY, ARKK, NVDA, TSLA, AVUV)': ['fund:MSTY', 'fund:ARKK', 'ticker:NVDA', 'ticker:TSLA', 'fund:AVUV'],
    'Ticker-only follower (NVDA, TSLA)': ['ticker:NVDA', 'ticker:TSLA'],
    'Catch-up fund only (ARKK)': ['fund:ARKK'],
    'Quiet watchlist (one ticker nobody moved)': ['ticker:ZZZZ'],
}


def parse_follows(items):
    out = []
    for it in items:
        kind, _, sym = it.partition(':')
        if kind not in ('fund', 'ticker') or not sym:
            raise SystemExit(f'bad follow {it!r}: use fund:SYM or ticker:SYM')
        out.append({'kind': kind, 'symbol': sym.upper()})
    return out


def simulate_monday(src):
    """Symlink copy of `src` where the newest non-trading-day file is renamed to the next weekday."""
    dest = tempfile.mkdtemp(prefix='tt-dryrun-')
    names = sorted(f for f in os.listdir(src) if f.startswith('holdings_') and f.endswith('.csv'))
    for n in names:
        os.symlink(os.path.join(src, n), os.path.join(dest, n))
    weekend = [n for n in names if not data._is_trading_day(n[9:-4])]
    if weekend:
        d = date.fromisoformat(weekend[-1][9:-4])
        while d.weekday() >= 5 or d.isoformat() in data._NYSE_HOLIDAYS:
            d += timedelta(days=1)
        os.remove(os.path.join(dest, weekend[-1]))
        os.symlink(os.path.join(src, weekend[-1]), os.path.join(dest, f'holdings_{d.isoformat()}.csv'))
    return dest


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--follow', nargs='*', help='fund:SYM / ticker:SYM entries for ONE custom follow list')
    ap.add_argument('--history', default=data.HISTORY_DIR)
    ap.add_argument('--simulate-monday', action='store_true')
    ap.add_argument('--out', help='also write the report to this file')
    a = ap.parse_args()

    tmp = simulate_monday(a.history) if a.simulate_monday else None
    data.HISTORY_DIR = tmp or a.history
    data._available_dates.cache_clear()
    day = data.get_as_of_date()
    lines = [f'# Digest dry run', '',
             f'- Snapshot date: **{day}** (trading day: {data._is_trading_day(day)}); previous: {data.get_available_dates()[1] if len(data.get_available_dates()) > 1 else "none"}',
             f'- Simulated Monday: {a.simulate_monday}',
             '- Sends nothing; opens no database; delivery functions are tripwires.', '']

    events = job.build_events(day)
    catch_up = data.get_catch_up_funds()
    trades = [e for e in events if e['kind'] == 'trade']
    infos = [e for e in events if e['kind'] == 'catch-up']
    lines += [f'- Events built from the guarded daily changes: **{len(trades)}** trade, **{len(infos)}** catch-up notice',
              f'- Catch-up funds right now (withheld from trades): {catch_up or "none"}', '']

    sets = {'Custom': parse_follows(a.follow)} if a.follow else {k: parse_follows(v) for k, v in DEFAULT_SETS.items()}
    failures = []
    for name, follows in sets.items():
        selected, payload = job.build_digest('dry-run-device', follows, day, events, 'dry-run-digest-id')
        lines += [f'## {name}', '', f'Follows: `{", ".join(f["kind"] + ":" + f["symbol"] for f in follows)}`', '']
        if not selected:
            lines += ['**Would send NOTHING** (empty digest: recorded as `empty`, no push).', '']
            if payload['body']:
                failures.append(f'{name}: empty selection but non-empty body')
            continue
        lines += ['**Notification the phone would show:**', '', f'> **{payload["title"]}**', f'> {payload["body"]}', '',
                  '**Push `data` payload:** `' + str(payload['data']) + '`', '',
                  f'**Private digest detail** (`GET /notifications/digests/<id>`): {len(selected)} event(s)', '']
        for e in selected:
            extra = f' [active Δ {e["activeWeightDelta"]:+.4f} pp, overlay={e["overlay"]}]' if e['kind'] == 'trade' else f' [since {e["since"]}]'
            lines.append(f'- `{e["kind"]}` {e["text"]}{extra}')
        lines.append('')
        # ---- honesty checks -------------------------------------------------------
        for e in selected:
            if e['kind'] == 'trade':
                if e['fund'] in catch_up:
                    failures.append(f'{name}: catch-up fund {e["fund"]} leaked as a trade')
                if e['type'] not in ('NEW', 'REMOVED') and abs(e['activeWeightDelta']) < job.NOTIFY_MIN_PP:
                    failures.append(f'{name}: {e["fund"]} {e["ticker"]} below the {job.NOTIFY_MIN_PP} pp notification floor')
            elif e['fund'] not in {f['symbol'] for f in follows if f['kind'] == 'fund'}:
                failures.append(f'{name}: catch-up notice for a fund the device does not follow')
        if len(payload['body']) > 240:
            failures.append(f'{name}: body is {len(payload["body"])} chars (long for a notification)')
    lines += ['## Checks', '']
    lines += [f'- FAIL: {f}' for f in failures] or ['- PASS: no catch-up fund leaked as a trade; every resized trade is at or above the 0.10 pp notification floor (NEW/EXIT are exempt); catch-up notices only for explicitly followed funds; empty digests send nothing.']
    report = '\n'.join(lines) + '\n'
    print(report)
    if a.out:
        with open(a.out, 'w') as f:
            f.write(report)
    if tmp:
        shutil.rmtree(tmp, ignore_errors=True)   # symlinks only; never touches the real files
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
