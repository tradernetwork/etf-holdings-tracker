"""
structures.py — option legs on one underlying, grouped into structures.

Why this exists: a flat CALL/PUT list hides what the funds are actually
doing. AMDY's AMD book reads as four unrelated contracts until you see that
+7,420 490C / −7,420 490.01P is ONE position — a synthetic long, i.e. stock —
with short call spreads written on top.

Two views per fund + underlying:

  structures  What the book holds right now, paired statically:
                synthetic-long / synthetic-short  (call + put, same expiry,
                    equal size, strikes within 1% — shared with the
                    effectiveness engine's split_synthetic_legs)
                call-spread / put-spread          (same type + expiry, equal
                    size, opposite signs; `credit` when the written leg is
                    the one nearer the money)
                collar                            (written call + long put,
                    same expiry, equal size)
                single                            (anything left)

  trades      What changed since the fund's previous snapshot. Legs whose
              day-over-day contract change has the SAME absolute size are
              paired — measured downstream at 85–89% of traded legs on
              2026-09-22…25:
                roll       same type, different expiry, one leg closing and
                           one opening on the same side
                synthetic  call + put, ~same strike and expiry (opened or closed)
                spread     same type + expiry, opposite changes
                collar     call + put, same expiry, different strikes
                pair       equal size but none of the above
              Unpaired changes are reported as `single`.

The previous snapshot is taken PER FUND: the newest earlier file that
actually contains that fund. A day an issuer fetch failed must not make
every position look freshly opened.
"""

from __future__ import annotations

import os
from collections import defaultdict
from functools import lru_cache
from itertools import combinations

from .data import (
    HISTORY_DIR,
    _clean_ticker,
    _nullable_float,
    _read_csv,
    get_available_dates,
    is_stale,
    option_leg_expired,
    option_leg_fields,
    row_file_date,
    row_refreshed,
)

# Snapshots to look back through for a fund's previous appearance.
_PREV_LOOKBACK = 6
_STRIKE_TOL = 0.01  # same tolerance as effectiveness._SYNTHETIC_STRIKE_TOL


def _leg_key(leg: dict) -> tuple:
    return (leg['optionType'], leg['strike'], leg['expiry'])


def _to_leg(r: dict) -> dict:
    f = option_leg_fields(r)
    return {
        'optionType': f['optionType'],
        'strike': f['strike'],
        'expiry': f['expiry'],
        'contracts': f['contracts'],
        'isFlex': f['isFlex'],
        'dte': _nullable_float(r.get('DTE')),
        'marketValue': _nullable_float(r.get('Market Value')),
        'occ': _clean_ticker(r.get('Ticker', '')),
    }


def _same_strike(a: float | None, b: float | None) -> bool:
    return a is not None and b is not None and abs(a - b) <= _STRIKE_TOL * max(a, b)


# ─── Held structures ─────────────────────────────────────────────────────────

def _pair_structures(legs: list[dict]) -> list[dict]:
    """Static pairing of the current book. Returns structures referencing
    legs by index into `legs`."""
    used: set[int] = set()
    out: list[dict] = []

    def take(kind: str, idx: list[int], **extra):
        used.update(idx)
        out.append({'kind': kind, 'legs': idx,
                    'contracts': abs(legs[idx[0]]['contracts']), **extra})

    idx_all = range(len(legs))
    # 1. Synthetics: long call + short put (or the reverse), equal size.
    for i in idx_all:
        a = legs[i]
        if i in used or a['optionType'] != 'CALL' or not a['contracts']:
            continue
        for j in idx_all:
            b = legs[j]
            if (j in used or b['optionType'] != 'PUT' or b['expiry'] != a['expiry']
                    or b['contracts'] != -a['contracts'] or not _same_strike(a['strike'], b['strike'])):
                continue
            take('synthetic-long' if a['contracts'] > 0 else 'synthetic-short', [i, j])
            break
    # 2. Vertical spreads: same type + expiry, opposite signs, equal size.
    for i, j in combinations(idx_all, 2):
        if i in used or j in used:
            continue
        a, b = legs[i], legs[j]
        if (a['optionType'] == b['optionType'] and a['expiry'] == b['expiry']
                and a['contracts'] == -b['contracts'] and a['contracts'] != 0
                and a['strike'] != b['strike']):
            short, long_ = (a, b) if a['contracts'] < 0 else (b, a)
            # Nearer-the-money written leg = credit: lower strike for calls,
            # higher strike for puts.
            if a['optionType'] == 'CALL':
                credit = short['strike'] < long_['strike']
            else:
                credit = short['strike'] > long_['strike']
            take('call-spread' if a['optionType'] == 'CALL' else 'put-spread', [i, j],
                 side='credit' if credit else 'debit')
    # 3. Collars: written call + long put, same expiry, equal size.
    for i, j in combinations(idx_all, 2):
        if i in used or j in used:
            continue
        a, b = legs[i], legs[j]
        call, put = (a, b) if a['optionType'] == 'CALL' else (b, a)
        if (call['optionType'] == 'CALL' and put['optionType'] == 'PUT'
                and call['expiry'] == put['expiry']
                and call['contracts'] < 0 and put['contracts'] == -call['contracts']):
            take('collar', [i, j])
    # 4. Everything else stands alone.
    for i in idx_all:
        if i not in used:
            leg = legs[i]
            side = 'written' if leg['contracts'] < 0 else 'long'
            take('single', [i], side=side)
    return out


# ─── Day-over-day trades ─────────────────────────────────────────────────────

_TRADE_PRIORITY = {'roll': 0, 'synthetic': 1, 'spread': 2, 'collar': 3, 'pair': 4}


def _classify_trade(a: dict, b: dict) -> str:
    """Kind of a pair of legs whose changes have equal absolute size."""
    da, db = a['change'], b['change']
    if a['optionType'] == b['optionType']:
        if a['expiry'] != b['expiry'] and da == -db:
            # Same side of the book before and after: one closes, one opens.
            side_a = a['contracts'] or a['prevContracts']
            side_b = b['contracts'] or b['prevContracts']
            if side_a and side_b and (side_a > 0) == (side_b > 0):
                return 'roll'
        if a['expiry'] == b['expiry'] and da == -db:
            return 'spread'
        return 'pair'
    # Call + put
    if a['expiry'] == b['expiry'] and da == -db:
        return 'synthetic' if _same_strike(a['strike'], b['strike']) else 'collar'
    return 'pair'


def _pair_trades(changed: list[dict]) -> list[dict]:
    """Greedy pairing within equal-|change| buckets, best kinds first."""
    by_size: dict[float, list[int]] = defaultdict(list)
    for i, leg in enumerate(changed):
        by_size[abs(leg['change'])].append(i)

    used: set[int] = set()
    trades: list[dict] = []
    for size, idx in by_size.items():
        candidates = []
        for i, j in combinations(idx, 2):
            kind = _classify_trade(changed[i], changed[j])
            candidates.append((_TRADE_PRIORITY[kind], i, j, kind))
        for _, i, j, kind in sorted(candidates):
            if i in used or j in used:
                continue
            used.update((i, j))
            trades.append({'kind': kind, 'size': size, 'legs': [changed[i], changed[j]]})
    for i, leg in enumerate(changed):
        if i not in used:
            trades.append({'kind': 'single', 'size': abs(leg['change']), 'legs': [leg]})
    trades.sort(key=lambda t: (_TRADE_PRIORITY.get(t['kind'], 9), -t['size']))
    return trades


# ─── Snapshot plumbing ───────────────────────────────────────────────────────

def _options_on(rows: list[dict], underlying: str) -> dict[str, list[dict]]:
    by_fund: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        if (r.get('Option_Type') or '').strip() and \
                (r.get('Underlying_Ticker') or '').strip().upper() == underlying:
            by_fund[r.get('ETF Ticker', '')].append(r)
    return by_fund


def _funds_in(rows: list[dict]) -> set[str]:
    return {r.get('ETF Ticker', '') for r in rows}


def get_option_structures(underlying: str) -> dict | None:
    """Every fund's option legs on `underlying`, as held structures and as
    today's paired trades. None when no fund holds an option on it."""
    underlying = underlying.upper()
    dates = get_available_dates()
    if not dates:
        return None
    as_of = dates[0]
    latest_rows = _read_csv(os.path.join(HISTORY_DIR, f'holdings_{as_of}.csv'))
    # Earlier snapshots are read lazily — usually only yesterday's is needed,
    # and each file is ~4 MB. Older ones load only for a fund missing from it.
    _loaded: dict[str, list[dict]] = {}

    def earlier():
        for d in dates[1:_PREV_LOOKBACK + 1]:
            if d not in _loaded:
                _loaded[d] = _read_csv(os.path.join(HISTORY_DIR, f'holdings_{d}.csv'))
            yield d, _loaded[d]

    current = _options_on(latest_rows, underlying)
    if not current:
        return None

    funds_out = []
    total_changed = total_paired = total_legs = 0
    for fund in sorted(current):
        # Held view: live contracts only. The day-over-day diff below uses
        # every row, expired or not, on both sides — filtering one side only
        # makes a frozen issuer file (EGGQ) look like it closed everything.
        rows = [r for r in current[fund] if not option_leg_expired(r, as_of)]
        all_cur_legs = [_to_leg(r) for r in current[fund]]
        fund_rows_all = [r for r in latest_rows if r.get('ETF Ticker') == fund]
        file_date = max((fd for fd in (row_file_date(r) for r in fund_rows_all) if fd), default=None)
        refreshed = row_refreshed(fund_rows_all[0]) if fund_rows_all else None
        legs = [_to_leg(r) for r in rows]
        legs.sort(key=lambda l: (l['expiry'] or '', l['optionType'] or '', l['strike'] or 0))

        # Previous snapshot that actually contains this fund.
        prev_date, prev_legs = None, {}
        for d, prows in earlier():
            if fund in _funds_in(prows):
                prev_date = d
                prev_legs = {_leg_key(l): l for l in (_to_leg(r) for r in _options_on(prows, underlying).get(fund, []))}
                break

        cur_by_key = {_leg_key(l): l for l in all_cur_legs}
        changed = []
        # A carried-forward book has no new information — no trades.
        if prev_date and refreshed is not False:
            for key in set(cur_by_key) | set(prev_legs):
                cur, prev = cur_by_key.get(key), prev_legs.get(key)
                c = cur['contracts'] if cur else 0.0
                p = prev['contracts'] if prev else 0.0
                if c == p:
                    continue
                base = cur or prev
                changed.append({**base, 'contracts': c, 'prevContracts': p, 'change': c - p})
            changed.sort(key=lambda l: (l['expiry'] or '', l['optionType'] or '', l['strike'] or 0))
        for l in legs:
            p = prev_legs.get(_leg_key(l))
            l['prevContracts'] = p['contracts'] if p else (0.0 if prev_date else None)
            l['change'] = (l['contracts'] - l['prevContracts']) if l['prevContracts'] is not None else None

        if not legs and not changed:
            continue  # only dead contracts left and nothing traded
        trades = _pair_trades(changed)
        paired = sum(len(t['legs']) for t in trades if t['kind'] != 'single')
        total_changed += len(changed)
        total_paired += paired
        total_legs += len(legs)
        funds_out.append({
            'fund': fund,
            'fileDate': file_date,
            'stale': is_stale(file_date, as_of),
            'refreshed': refreshed,
            'compareDate': prev_date,
            'legs': legs,
            'structures': _pair_structures(legs),
            'trades': trades,
            'tradedLegs': len(changed),
            'pairedLegs': paired,
            'pairedPct': round(paired / len(changed) * 100, 1) if changed else None,
        })

    return {
        'underlying': underlying,
        'asOfDate': as_of,
        'fundCount': len(funds_out),
        'legCount': total_legs,
        'tradedLegs': total_changed,
        'pairedLegs': total_paired,
        'pairedPct': round(total_paired / total_changed * 100, 1) if total_changed else None,
        'funds': funds_out,
    }


# ─── Per-fund activity timeline ──────────────────────────────────────────────
# The fund page used to show option "activity" as ADDED/TRIMMED badges driven
# by WEIGHT changes — which move with price even when no contract trades
# (KQQQ's synthetic legs read TRIMMED on a day they held exactly 238 contracts
# both sides). This timeline is built from CONTRACT changes only, dated, and
# paired into what each change is.

@lru_cache(maxsize=48)
def _snapshot_cached(path: str, mtime: float) -> tuple[tuple, frozenset]:
    """(option rows, funds present) of one snapshot, parsed once and cached by
    (path, mtime) — a rewritten file gets a new mtime and is re-read, so
    freshness is unchanged. Only option rows are kept, so memory stays small."""
    rows = _read_csv(path)
    return (tuple(r for r in rows if (r.get('Option_Type') or '').strip()),
            frozenset(r.get('ETF Ticker', '') for r in rows))


def _snapshot(day: str) -> tuple[tuple, frozenset]:
    path = os.path.join(HISTORY_DIR, f'holdings_{day}.csv')
    return _snapshot_cached(path, os.path.getmtime(path))


def _single_kind(leg: dict, day: str) -> str:
    """What a lone contract change is."""
    cur, prev = leg['contracts'], leg['prevContracts']
    if not prev:
        return 'open'
    if not cur:
        return 'expired' if leg['expiry'] and leg['expiry'] <= day else 'close'
    if (cur > 0) != (prev > 0):
        return 'flip'
    return 'add' if abs(cur) > abs(prev) else 'reduce'


def get_fund_option_activity(fund: str, days: int = 10) -> dict:
    """The fund's option trades over its last `days` snapshots, newest first.

    Each day is compared with the fund's previous snapshot (skipping files the
    fund is missing from). Days whose rows were carried forward carry no new
    information and are listed as `refreshed: false` with no trades.
    """
    fund = fund.upper()
    dates = get_available_dates()
    out_days = []
    # A few extra snapshots so days the fund was missing don't shorten the window.
    present = [d for d in dates[: days + 4] if fund in _snapshot(d)[1]]
    for day, prev_day in zip(present, present[1:]):
        if len(out_days) >= days:
            break
        cur_rows = [r for r in _snapshot(day)[0] if r.get('ETF Ticker') == fund]
        prev_rows = [r for r in _snapshot(prev_day)[0] if r.get('ETF Ticker') == fund]
        refreshed = row_refreshed(cur_rows[0]) if cur_rows else None
        entry = {'date': day, 'compareDate': prev_day, 'refreshed': refreshed, 'trades': []}
        if refreshed is False:
            out_days.append(entry)
            continue

        def keyed(rows):
            m = {}
            for r in rows:
                leg = _to_leg(r)
                leg['underlying'] = (r.get('Underlying_Ticker') or '').strip().upper()
                m[(leg['underlying'],) + _leg_key(leg)] = leg
            return m

        cur, prev = keyed(cur_rows), keyed(prev_rows)
        by_und: dict[str, list[dict]] = defaultdict(list)
        for k in set(cur) | set(prev):
            c = cur[k]['contracts'] if k in cur else 0.0
            p = prev[k]['contracts'] if k in prev else 0.0
            if c == p:
                continue
            base = cur.get(k) or prev[k]
            by_und[k[0]].append({**base, 'contracts': c, 'prevContracts': p, 'change': c - p})
        for und in sorted(by_und):
            for t in _pair_trades(by_und[und]):
                t['underlying'] = und
                if t['kind'] == 'single':
                    t['action'] = _single_kind(t['legs'][0], day)
                t['legs'].sort(key=lambda l: (l['expiry'] or '', l['strike'] or 0))
                entry['trades'].append(t)
        entry['trades'].sort(key=lambda t: (-max(abs(l['change']) * (l['strike'] or 0) for l in t['legs'])))
        out_days.append(entry)

    return {'fund': fund, 'days': out_days}
