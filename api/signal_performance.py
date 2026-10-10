"""
Signal-vs-price backtest.  *** KNOWN-FLAWED — see the caveat block below. ***

KNOWN FLAWS (measured 2026-09-03, dashboard card removed as a result):
  1. Uses the raw `Weight` column rather than activeWeightDelta, so it grades a
     signal the product does not serve (raw weight agrees with the fund's real
     share change only ~49% of the time).
  2. No category filter — option-income collateral churn counts as conviction.
  3. No benchmark. 54.7% buying looks like a pass and is below the 60.9% base
     rate of the tracked universe.
  4. Forward windows count calendar days, not trading days.
Fixing 1-4 is a real piece of work; a corrected rerun lives in the session
notes for 2026-09-03. Until then this output is not evidence of anything.

The core question this WAS MEANT to answer: "If you'd followed the TickerTrace signals,
would you have made money?" Built once and cached to disk; the API endpoint
just reads the cache. The scrape cron regenerates it daily.

How it works
------------
1. Walk the entire CSV history under etf-dashboard/public/data/history/.
   For each consecutive pair of days (D-1, D), emit a "signal" for every
   (fund, ticker) whose weight changed: { signal_date, fund, ticker,
   direction, weight_delta }.

2. Pull underlying prices for every unique ticker over the backtest window
   via yfinance (batched). Cache the price series to JSON so subsequent
   runs only fetch incremental dates.

3. For each signal, compute the N-day forward return on the underlying.
   Direction "buying" wins if return > 0; "selling" wins if return < 0.

4. Aggregate by direction and provider — median return, win rate, count.

Options-based signals are excluded from v1: the option contract's value
depends on Δ, θ, σ — a flat "did the underlying go up?" misrepresents
whether the option position worked. Worth doing separately, later.

Output shape (signal_performance.json)
--------------------------------------
{
  "asOf":         "2026-05-16",      // most recent CSV date seen
  "generatedAt":  "2026-05-19T03:14:21Z",
  "lookbackDays": 30,
  "totalSignals": 2847,
  "withReturns":  1842,               // signals old enough to have a forward return
  "overall": {
    "buying":  {"medianReturn": 0.052, "winRate": 0.61, "n": 1100},
    "selling": {"medianReturn": -0.012, "winRate": 0.54, "n":  742}
  },
  "byProvider": {
    "ARK Invest": { "buying": {...}, "selling": {...} },
    ...
  }
}
"""

from __future__ import annotations

import json
import os
import statistics
import time
from datetime import datetime, timezone
from typing import Iterator

from api.data import (
    FUND_PROVIDERS,
    HISTORY_DIR,
    _clean_ticker,
    _read_csv,
    catch_up_funds_between,
    _safe_float,
    get_available_dates,
)

# Output lives under etf-dashboard/public/data so:
#  - the API container picks it up via the existing read-only volume mount
#  - Vercel serves it as a static asset at /data/signal_performance.json
#  - the dashboard server component can read it directly from disk during build
#    (Next.js public/ is part of the build context)
# The yfinance price cache stays in the project-root data/ — it's a build-side
# artifact, not something the API needs at runtime.
PUBLIC_DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'etf-dashboard', 'public', 'data')
CACHE_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')
PRICE_CACHE = os.path.join(CACHE_DIR, 'signal_performance_prices.json')
RESULT_CACHE = os.path.join(PUBLIC_DATA_DIR, 'signal_performance.json')

# Tickers that yfinance won't have or that are noise (cash, T-bills).
EXCLUDED_UNDERLYINGS = {'CASH', 'USD', 'OTHER', 'N/A', ''}


# ─── Signal generation ──────────────────────────────────────────────────────

def _holding_weight_map(rows: list[dict]) -> dict[tuple[str, str], float]:
    """Build {(fund, ticker): weight} from a single day's rows, equity only."""
    out: dict[tuple[str, str], float] = {}
    for r in rows:
        if r.get('Option_Type'):  # exclude options from this backtest
            continue
        fund = r.get('ETF Ticker', '')
        tkr = _clean_ticker(r.get('Ticker', ''))
        if not fund or not tkr or tkr in EXCLUDED_UNDERLYINGS:
            continue
        out[(fund, tkr)] = _safe_float(r.get('Weight', '0'))
    return out


def generate_all_signals(history_dir: str = HISTORY_DIR) -> list[dict]:
    """Walk the CSV history, emit signals for every weight change."""
    # get_available_dates returns newest-first; reverse so we can iterate
    # consecutive pairs (prev_date, curr_date).
    dates = sorted([
        f.replace('holdings_', '').replace('.csv', '')
        for f in os.listdir(history_dir)
        if f.startswith('holdings_') and f.endswith('.csv')
    ])
    if len(dates) < 2:
        return []

    signals: list[dict] = []
    prev_map: dict[tuple[str, str], float] | None = None
    prev_rows: list[dict] | None = None
    for date in dates:
        rows = _read_csv(os.path.join(history_dir, f'holdings_{date}.csv'))
        curr_map = _holding_weight_map(rows)
        if prev_map is not None:
            # A fund coming back from carried-forward rows (ARK: 2026-09-25 ->
            # first fresh scrape) shows its whole gap as one day. That is not a
            # day's signal and must never seed a forward-return window.
            catch_up = catch_up_funds_between(rows, prev_rows)
            keys = set(prev_map.keys()) | set(curr_map.keys())
            for key in keys:
                if key[0] in catch_up:
                    continue
                prev_w = prev_map.get(key, 0.0)
                curr_w = curr_map.get(key, 0.0)
                delta = curr_w - prev_w
                if abs(delta) < 0.001:  # rounding noise — skip
                    continue
                fund, ticker = key
                signals.append({
                    'date': date,
                    'fund': fund,
                    'ticker': ticker,
                    'provider': FUND_PROVIDERS.get(fund, fund),
                    'direction': 'buying' if delta > 0 else 'selling',
                    'weightDelta': delta,
                })
        prev_map = curr_map
        prev_rows = rows
    return signals


# ─── Price fetching (yfinance with persistent cache) ────────────────────────

def _load_price_cache() -> dict[str, dict[str, float]]:
    if not os.path.exists(PRICE_CACHE):
        return {}
    try:
        with open(PRICE_CACHE) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def _save_price_cache(cache: dict[str, dict[str, float]]) -> None:
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(PRICE_CACHE, 'w') as f:
        json.dump(cache, f, separators=(',', ':'))


def fetch_prices(tickers: set[str], start: str, end: str,
                 max_batch: int = 50) -> dict[str, dict[str, float]]:
    """Fetch daily close prices for a set of tickers, with persistent cache.

    Returns {ticker: {YYYY-MM-DD: close_price}}. Tickers yfinance can't
    resolve are silently omitted (corp actions, delisted, etc).
    """
    cache = _load_price_cache()
    # We re-fetch a ticker if its cached range doesn't cover [start, end].
    needs_fetch: list[str] = []
    for t in tickers:
        if t not in cache:
            needs_fetch.append(t)
            continue
        dates = cache[t].keys()
        if not dates or min(dates) > start or max(dates) < end:
            needs_fetch.append(t)
    if needs_fetch:
        import yfinance as yf  # lazy import — slow module
        # Pad end by a few business days so forward returns at the tail of
        # the window have something to lookup.
        for i in range(0, len(needs_fetch), max_batch):
            batch = needs_fetch[i:i + max_batch]
            try:
                hist = yf.download(
                    tickers=batch,
                    start=start,
                    end=end,
                    progress=False,
                    auto_adjust=True,
                    threads=True,
                )
            except Exception as e:
                print(f'yfinance batch failed ({len(batch)} tickers): {e}')
                continue
            if hist is None or hist.empty:
                continue
            # Multi-ticker shape: columns are MultiIndex (field, ticker).
            # Single-ticker: flat columns. Normalize.
            if len(batch) == 1:
                t = batch[0]
                cols = hist.columns
                has_close = 'Close' in cols or (
                    hasattr(cols, 'get_level_values')
                    and 'Close' in cols.get_level_values(0))
                if not has_close:
                    continue
                closes = hist['Close']
                # Newer yfinance returns a 1-column DataFrame (or a MultiIndex
                # slice) even for a single ticker. Squeeze to a Series so the
                # NaN guard below compares scalars — a Series in a bool context
                # raises "truth value of a Series is ambiguous" and aborts the
                # whole daily backtest.
                if getattr(closes, 'ndim', 1) > 1:
                    closes = closes.iloc[:, 0]
                cache[t] = {d.strftime('%Y-%m-%d'): float(v)
                            for d, v in closes.items() if v == v}  # NaN guard
            else:
                closes = hist['Close'] if 'Close' in hist.columns.get_level_values(0) else None
                if closes is None:
                    continue
                for t in batch:
                    if t not in closes.columns:
                        continue
                    cache[t] = {d.strftime('%Y-%m-%d'): float(v)
                                for d, v in closes[t].items() if v == v}
            time.sleep(0.3)  # be polite
        _save_price_cache(cache)
    return cache


# ─── Returns + aggregation ──────────────────────────────────────────────────

def _forward_return(prices: dict[str, float], signal_date: str,
                    lookback_days: int) -> float | None:
    """Find close on signal_date, then the close ~lookback_days later.

    If signal_date isn't a trading day, walks forward up to 5 days.
    If the forward window extends past available data, returns None.
    """
    if not prices:
        return None
    sorted_dates = sorted(prices.keys())

    def first_after(target: str) -> str | None:
        for d in sorted_dates:
            if d >= target:
                return d
        return None

    p0_date = first_after(signal_date)
    if p0_date is None or p0_date > _add_days(signal_date, 5):
        return None
    target_end = _add_days(p0_date, lookback_days)
    p1_date = first_after(target_end)
    if p1_date is None:
        return None
    p0, p1 = prices[p0_date], prices[p1_date]
    if p0 <= 0:
        return None
    return (p1 - p0) / p0


def _add_days(date_str: str, days: int) -> str:
    d = datetime.strptime(date_str, '%Y-%m-%d')
    from datetime import timedelta
    return (d + timedelta(days=days)).strftime('%Y-%m-%d')


def _aggregate(returns: list[float], direction: str) -> dict:
    """Median return + win rate over a list of returns."""
    if not returns:
        return {'medianReturn': 0.0, 'winRate': 0.0, 'n': 0}
    wins = sum(1 for r in returns if (r > 0 if direction == 'buying' else r < 0))
    return {
        'medianReturn': round(statistics.median(returns), 4),
        'winRate': round(wins / len(returns), 3),
        'n': len(returns),
    }


def compute(lookback_days: int = 30,
            history_dir: str = HISTORY_DIR) -> dict:
    """Top-level: backtest every signal, return the aggregated payload."""
    signals = generate_all_signals(history_dir)
    if not signals:
        return {
            'asOf': 'unknown',
            'generatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
            'lookbackDays': lookback_days,
            'totalSignals': 0,
            'withReturns': 0,
            'overall': {'buying': _aggregate([], 'buying'),
                        'selling': _aggregate([], 'selling')},
            'byProvider': {},
        }

    tickers = {s['ticker'] for s in signals}
    start = min(s['date'] for s in signals)
    end = _add_days(max(s['date'] for s in signals), lookback_days + 10)
    prices_by_ticker = fetch_prices(tickers, start=start, end=end)

    # Pair each signal with its forward return.
    enriched: list[dict] = []
    for s in signals:
        ret = _forward_return(prices_by_ticker.get(s['ticker'], {}),
                              s['date'], lookback_days)
        if ret is None:
            continue
        enriched.append({**s, 'forwardReturn': ret})

    overall = {
        'buying': _aggregate([e['forwardReturn'] for e in enriched
                              if e['direction'] == 'buying'], 'buying'),
        'selling': _aggregate([e['forwardReturn'] for e in enriched
                               if e['direction'] == 'selling'], 'selling'),
    }
    by_provider: dict[str, dict] = {}
    providers = {e['provider'] for e in enriched}
    for p in sorted(providers):
        by_provider[p] = {
            'buying': _aggregate([e['forwardReturn'] for e in enriched
                                  if e['direction'] == 'buying' and e['provider'] == p],
                                 'buying'),
            'selling': _aggregate([e['forwardReturn'] for e in enriched
                                   if e['direction'] == 'selling' and e['provider'] == p],
                                  'selling'),
        }
    return {
        'asOf': max(s['date'] for s in signals),
        'generatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'lookbackDays': lookback_days,
        'totalSignals': len(signals),
        'withReturns': len(enriched),
        'overall': overall,
        'byProvider': by_provider,
    }


def write_cache(payload: dict, path: str = RESULT_CACHE) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(payload, f, indent=2)


def read_cache(path: str = RESULT_CACHE) -> dict | None:
    if not os.path.exists(path):
        return None
    try:
        with open(path) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


if __name__ == '__main__':
    import sys
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 30
    print(f'Running backtest with {days}-day lookback...')
    result = compute(lookback_days=days)
    write_cache(result)
    print(f'  Signals processed: {result["totalSignals"]}')
    print(f'  With forward returns: {result["withReturns"]}')
    print(f'  Overall buying: median {result["overall"]["buying"]["medianReturn"]:+.2%}'
          f' winrate {result["overall"]["buying"]["winRate"]:.1%}'
          f' n={result["overall"]["buying"]["n"]}')
    print(f'  Overall selling: median {result["overall"]["selling"]["medianReturn"]:+.2%}'
          f' winrate {result["overall"]["selling"]["winRate"]:.1%}'
          f' n={result["overall"]["selling"]["n"]}')
    print(f'Result cached to {RESULT_CACHE}')
