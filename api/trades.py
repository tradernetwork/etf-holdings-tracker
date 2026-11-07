"""
Intraday trade blotter — what the funds actually *executed*.

Everything else in TickerTrace infers activity by diffing end-of-day holdings
snapshots. That is blind to anything opened and closed inside one session (0DTE
call writing, intraday rolls) and it cannot say at what price a position was
built. YieldMax publishes a trade file (date, fund, ticker, side, qty, exec
price); this module parses it, stores it, and replays it into FIFO realized P&L.

Storage is plain CSV like the rest of the product: one file per *trade date* at
``etf-dashboard/public/data/trades/trades_YYYY-MM-DD.csv``. The scraper side
lives in ``scripts/scrape_intraday_trades.py``; this module is the part the API
image needs (it only copies ``api/``), so everything the API reads is here.

Side codes as published (verified against the provider's file layout, not
against a live fetch from this repo's CI yet):

    B   buy            opens / adds to a long
    S   sell           closes / reduces a long
    SS  sell short     opens / adds to a short   (options: sell to open)
    BC  buy to cover   closes / reduces a short  (options: buy to close)

Design notes — each is a deliberate departure from the obvious implementation:

* **Dedupe is count-aware.** The provider republishes the same blotter for a
  while, and two genuine fills can be identical (same fund, name, side, qty,
  price). A plain "unique key" drops the second real fill; a plain append
  doubles everything on re-ingest. ``merge_trades`` keeps, per key, the larger
  of the stored count and the incoming count — idempotent *and* lossless.
* **Fund is part of the key and of the lot book.** One file covers every fund;
  two funds trading the same contract must never net against each other.
* **Option legs carry the x100 multiplier** in notional / P&L.
* **Worthless expiries are closed out.** A written option that is never bought
  back never shows up as a trade; without this its lot would sit open forever.
"""

from __future__ import annotations

import csv
import datetime as dt
import glob
import os
import re
from collections import Counter, defaultdict, deque
from typing import Iterable

TRADES_DIR = os.path.join(
    os.path.dirname(__file__), '..', 'etf-dashboard', 'public', 'data', 'trades'
)

COLUMNS = ('date', 'fund', 'ticker', 'side', 'qty', 'price')
OPTION_MULTIPLIER = 100

# side -> (opens a position?, direction of the position it touches)
SIDES = {
    'B': ('open', 'long'),
    'S': ('close', 'long'),
    'SS': ('open', 'short'),
    'BC': ('close', 'short'),
}

# Same OCC shape scrape_avantis.parse_option accepts: optional leading digit for
# exchange-prefixed roots ("2MU   260918C00950000"), root, YYMMDD, C/P, strike*1000.
_OCC = re.compile(r'^\d?([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$')
_FUND = re.compile(r'^[A-Z]{1,6}$')


# ─── Parsing ─────────────────────────────────────────────────────────────

def to_number(raw) -> float | None:
    """'1,234,567.5', '$12.30', '(500)' -> float. Every comma is stripped (the
    first-comma-only bug turns '1,234,567' into garbage). None if not numeric."""
    if raw is None:
        return None
    s = str(raw).strip().replace('$', '').replace(',', '').replace(' ', '')
    if not s:
        return None
    neg = s.startswith('(') and s.endswith(')')
    s = s.strip('()')
    try:
        v = float(s)
    except ValueError:
        return None
    return -v if neg else v


def parse_trade_date(raw) -> str | None:
    s = str(raw or '').strip()
    for fmt in ('%m/%d/%Y', '%Y-%m-%d', '%m/%d/%y'):
        try:
            return dt.datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def parse_occ(ticker: str) -> dict | None:
    """Option contract fields from an OCC-style ticker, or None for a stock."""
    m = _OCC.match(re.sub(r'\s+', '', ticker or '').upper())
    if not m:
        return None
    root, yy, mm, dd, cp, strike = m.groups()
    try:
        expiry = dt.date(2000 + int(yy), int(mm), int(dd)).isoformat()
    except ValueError:
        return None
    return {
        'underlying': root,
        'optionType': 'CALL' if cp == 'C' else 'PUT',
        'strike': int(strike) / 1000,
        'expiry': expiry,
    }


def normalize_ticker(raw: str) -> str:
    """Collapse the padded OCC spacing ('AFRM  250829C00083000') so the same
    contract always has one spelling; plain tickers are just trimmed/uppercased."""
    return re.sub(r'\s+', '', str(raw or '')).upper()


def parse_trades(raw_rows: Iterable[dict]) -> tuple[list[dict], dict]:
    """Provider rows -> normalized trades, plus a count of every row we refused.

    Nothing is dropped silently: ``rejected`` says how many rows failed and why,
    so a format change at the provider shows up as a spike in the scrape log
    instead of as trades quietly vanishing."""
    trades: list[dict] = []
    rejected: Counter = Counter()
    for r in raw_rows:
        g = {(k or '').strip().lower(): v for k, v in r.items()}
        fund = str(g.get('fund') or '').strip().upper()
        ticker = normalize_ticker(g.get('ticker'))
        side = str(g.get('type') or g.get('side') or '').strip().upper()
        qty = to_number(g.get('qty/par value', g.get('qty')))
        price = to_number(g.get('exec price', g.get('price')))
        date = parse_trade_date(g.get('date'))
        if not fund or not ticker:
            rejected['missing_fund_or_ticker'] += 1
        elif not _FUND.match(fund):
            rejected['bad_fund'] += 1
        elif side not in SIDES:
            rejected[f'unknown_side:{side or "blank"}'] += 1
        elif date is None:
            rejected['bad_date'] += 1
        elif qty is None or qty <= 0:
            rejected['bad_qty'] += 1
        elif price is None or price < 0:
            rejected['bad_price'] += 1
        else:
            trades.append({'date': date, 'fund': fund, 'ticker': ticker,
                           'side': side, 'qty': qty, 'price': price})
    return trades, dict(rejected)


def enrich(t: dict) -> dict:
    """Add instrument details + notional to a stored trade (read-side only)."""
    opt = parse_occ(t['ticker'])
    mult = OPTION_MULTIPLIER if opt else 1
    out = {**t, 'instrument': 'option' if opt else 'stock', 'multiplier': mult,
           'notional': round(t['qty'] * t['price'] * mult, 2)}
    if opt:
        out.update(opt)
    return out


# ─── Storage ─────────────────────────────────────────────────────────────

def _key(t: dict) -> tuple:
    return (t['date'], t['fund'], t['ticker'], t['side'], round(t['qty'], 6), round(t['price'], 6))


def merge_trades(existing: list[dict], incoming: list[dict]) -> list[dict]:
    """Union two copies of a blotter without losing or duplicating fills.

    Per identical key keep ``max(count_existing, count_incoming)``: re-ingesting
    the same snapshot adds nothing, and a snapshot that shows a fill the stored
    one lacks adds exactly that fill — including a genuine second identical one."""
    have, new = Counter(map(_key, existing)), Counter(map(_key, incoming))
    out = list(existing)
    seen: Counter = Counter()
    for t in incoming:
        k = _key(t)
        seen[k] += 1
        if seen[k] > have[k] and seen[k] <= new[k]:
            out.append(t)
    return sorted(out, key=lambda t: (t['date'], t['fund'], t['ticker'], t['side'], t['qty'], t['price']))


def _path(trades_dir: str, date: str) -> str:
    return os.path.join(trades_dir, f'trades_{date}.csv')


def read_day(path: str) -> list[dict]:
    if not os.path.exists(path):
        return []
    with open(path, newline='', encoding='utf-8') as f:
        rows = []
        for r in csv.DictReader(f):
            q, p = to_number(r.get('qty')), to_number(r.get('price'))
            if q is None or p is None or r.get('side') not in SIDES:
                continue
            rows.append({'date': r['date'], 'fund': r['fund'], 'ticker': r['ticker'],
                         'side': r['side'], 'qty': q, 'price': p})
        return rows


def _fmt(x: float) -> str:
    """Fixed-point, no exponent: '%g' would write 1234567 as 1.23457e+06 and
    silently truncate large share counts on disk."""
    return ('%.6f' % x).rstrip('0').rstrip('.')


def write_trades(trades: list[dict], trades_dir: str | None = None) -> dict:
    """Merge ``trades`` into the per-date files. Returns {date: rows_added}."""
    trades_dir = trades_dir or TRADES_DIR
    os.makedirs(trades_dir, exist_ok=True)
    by_date: dict[str, list[dict]] = defaultdict(list)
    for t in trades:
        by_date[t['date']].append(t)
    added: dict[str, int] = {}
    for date, rows in sorted(by_date.items()):
        path = _path(trades_dir, date)
        before = read_day(path)
        merged = merge_trades(before, rows)
        added[date] = len(merged) - len(before)
        if added[date]:
            with open(path, 'w', newline='', encoding='utf-8') as f:
                w = csv.writer(f)
                w.writerow(COLUMNS)
                for t in merged:
                    w.writerow([t['date'], t['fund'], t['ticker'], t['side'],
                                _fmt(t['qty']), _fmt(t['price'])])
    return added


_cache: dict = {}


def load_trades(trades_dir: str | None = None) -> list[dict]:
    """Every stored trade, oldest first. Cached on the files' mtimes, so a new
    day's file shows up on the next request without a restart."""
    trades_dir = trades_dir or TRADES_DIR
    files = sorted(glob.glob(os.path.join(trades_dir, 'trades_*.csv')))
    sig = (trades_dir, tuple((f, os.stat(f).st_mtime_ns) for f in files))
    if _cache.get('sig') != sig:
        rows: list[dict] = []
        for f in files:
            rows.extend(read_day(f))
        _cache.update(sig=sig, rows=rows)
    return list(_cache['rows'])


# ─── FIFO replay ─────────────────────────────────────────────────────────

def replay_fifo(trades: list[dict], as_of: str | None = None) -> dict:
    """Replay the blotter in order into realized P&L and still-open lots.

    Lots are per (fund, ticker). A closing trade eats the oldest opposite lot
    first. Closing quantity with no lot behind it (the position was opened
    before we started collecting this file) is *counted, not invented*: it is
    reported as ``unmatchedClosingQty`` so P&L is never silently overstated.
    Option lots past expiry as of ``as_of`` close worthless at 0.

    Same-day order is not recoverable from the file, so within a date opens are
    applied before closes — otherwise a 0DTE write-and-buy-back looks unmatched.
    """
    order = sorted(trades, key=lambda t: (t['date'], SIDES[t['side']][0] != 'open'))
    as_of = as_of or (max((t['date'] for t in trades), default=None))
    books: dict[tuple, dict[str, deque]] = defaultdict(lambda: {'long': deque(), 'short': deque()})
    realized: list[dict] = []
    unmatched: Counter = Counter()

    def close_lot(fund, ticker, lot, qty, direction, close_price, close_date, reason):
        mult = OPTION_MULTIPLIER if parse_occ(ticker) else 1
        per = (close_price - lot['price']) if direction == 'long' else (lot['price'] - close_price)
        realized.append({
            'fund': fund, 'ticker': ticker, 'direction': direction, 'qty': qty,
            'openDate': lot['date'], 'openPrice': lot['price'],
            'closeDate': close_date, 'closePrice': close_price,
            'pnl': round(per * qty * mult, 2), 'closeReason': reason,
        })

    for t in order:
        action, direction = SIDES[t['side']]
        book = books[(t['fund'], t['ticker'])][direction]
        if action == 'open':
            book.append({'date': t['date'], 'price': t['price'], 'qty': t['qty']})
            continue
        left = t['qty']
        while left > 1e-9 and book:
            lot = book[0]
            take = min(lot['qty'], left)
            close_lot(t['fund'], t['ticker'], lot, take, direction, t['price'], t['date'], 'trade')
            lot['qty'] -= take
            left -= take
            if lot['qty'] <= 1e-9:
                book.popleft()
        if left > 1e-9:
            unmatched[(t['fund'], t['ticker'])] += left

    open_lots: list[dict] = []
    for (fund, ticker), sides in books.items():
        opt = parse_occ(ticker)
        for direction, lots in sides.items():
            for lot in lots:
                if opt and as_of and opt['expiry'] < as_of:
                    close_lot(fund, ticker, lot, lot['qty'], direction, 0.0, opt['expiry'], 'expired')
                else:
                    open_lots.append({'fund': fund, 'ticker': ticker, 'direction': direction,
                                      'qty': lot['qty'], 'openDate': lot['date'], 'openPrice': lot['price']})
    realized.sort(key=lambda r: (r['closeDate'], r['fund'], r['ticker']))
    return {'realized': realized, 'openLots': open_lots,
            'unmatchedClosingQty': {f'{f}:{t}': q for (f, t), q in sorted(unmatched.items())}}


# ─── API surface ─────────────────────────────────────────────────────────

def get_trades(fund: str | None = None, ticker: str | None = None, days: int = 5,
               limit: int = 200, trades_dir: str | None = None) -> dict:
    """Recent executed trades + per-fund summary + FIFO realized P&L.

    P&L is computed from *all* stored history (FIFO needs the opening leg), then
    filtered; ``historyStart`` tells the reader how far back that actually goes,
    which is the honest bound on every realized figure."""
    allt = load_trades(trades_dir)
    if not allt:
        return {'asOfDate': None, 'historyStart': None, 'count': 0, 'trades': [],
                'summary': [], 'realized': {'totalPnl': 0, 'closed': 0, 'byFund': []},
                'unmatchedClosingQty': {}}
    last = max(t['date'] for t in allt)
    first = min(t['date'] for t in allt)
    cutoff = (dt.date.fromisoformat(last) - dt.timedelta(days=max(days, 1) - 1)).isoformat()
    f = fund.upper() if fund else None
    tk = normalize_ticker(ticker) if ticker else None

    def keep(t):
        return (not f or t['fund'] == f) and (not tk or tk in (t['ticker'], parse_occ(t['ticker']) and parse_occ(t['ticker'])['underlying']))

    window = [t for t in allt if t['date'] >= cutoff and keep(t)]
    window.sort(key=lambda t: (t['date'], t['fund'], t['ticker']), reverse=True)

    summ: dict[str, dict] = {}
    for t in map(enrich, window):
        s = summ.setdefault(t['fund'], {'fund': t['fund'], 'trades': 0, 'bought': 0.0, 'sold': 0.0, 'optionTrades': 0})
        s['trades'] += 1
        s['optionTrades'] += t['instrument'] == 'option'
        s['bought' if SIDES[t['side']] in (('open', 'long'), ('close', 'short')) else 'sold'] += t['notional']
    summary = sorted(({**s, 'bought': round(s['bought'], 2), 'sold': round(s['sold'], 2),
                       'net': round(s['bought'] - s['sold'], 2)} for s in summ.values()),
                     key=lambda s: -s['trades'])

    fifo = replay_fifo(allt, as_of=last)
    closed = [r for r in fifo['realized'] if r['closeDate'] >= cutoff and keep(r)]
    by_fund: dict[str, dict] = {}
    for r in closed:
        b = by_fund.setdefault(r['fund'], {'fund': r['fund'], 'closed': 0, 'pnl': 0.0, 'wins': 0})
        b['closed'] += 1
        b['pnl'] += r['pnl']
        b['wins'] += r['pnl'] > 0
    return {
        'asOfDate': last, 'historyStart': first, 'windowDays': days,
        'count': min(len(window), limit), 'total': len(window),
        'trades': [enrich(t) for t in window[:limit]],
        'summary': summary,
        'realized': {
            'totalPnl': round(sum(r['pnl'] for r in closed), 2), 'closed': len(closed),
            'byFund': sorted(({**b, 'pnl': round(b['pnl'], 2)} for b in by_fund.values()), key=lambda b: -abs(b['pnl'])),
        },
        'unmatchedClosingQty': {k: v for k, v in fifo['unmatchedClosingQty'].items()
                                if (not f or k.startswith(f + ':'))},
    }
