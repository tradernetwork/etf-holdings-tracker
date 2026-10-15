#!/usr/bin/env python3
"""Preregistered ETF-strike proximity study. No historical OI or invented strikes.

python scripts/research/etf_pin_test.py --fetch-prices --output /tmp/pin-output
Re-run offline with --prices-dir /tmp/pin-output/prices instead of --fetch-prices.
"""
from __future__ import annotations
import argparse
import csv
import datetime as dt
import hashlib
from functools import lru_cache
import itertools
import json
import math
from pathlib import Path
import random
import re
import statistics
import urllib.request
from zoneinfo import ZoneInfo

SYMBOLS = ('MSTR', 'TSLA', 'NVDA', 'COIN')
SEED = 20261015
ROOT = Path(__file__).resolve().parents[2]


def number(value):
    try:
        return float(str(value).replace(',', '').replace('$', '').replace('(', '-').replace(')', ''))
    except (ValueError, TypeError):
        return None


@lru_cache(maxsize=1024)
def date_value(value):
    for fmt in ('%Y-%m-%d', '%m/%d/%Y'):
        try:
            return dt.datetime.strptime(str(value)[:10], fmt).date()
        except ValueError:
            pass
    return None


def contract(row):
    """Return standard root/expiry/type/strike, conservatively exclude FLEX/adjusted."""
    ticker = (row.get('Ticker') or '').strip()
    name = (row.get('Name') or '').strip()
    if str(row.get('Is_Flex', '')).lower() == 'true' or any(re.match(r'^\d[A-Z]', value) for value in (ticker, name)):
        return None
    underlying = row.get('Underlying_Ticker', '').strip()
    expiry = date_value(row.get('Option_Expiry'))
    kind = row.get('Option_Type', '').upper()[:1]
    strike = number(row.get('Option_Strike'))
    if underlying not in SYMBOLS or not expiry or kind not in ('C', 'P') or strike is None:
        match = re.fullmatch(r'([A-Z]+)\s*(\d{6})([CP])(\d{8})', ticker)
        if match:
            underlying, day, kind, encoded = match.groups()
            expiry = dt.datetime.strptime(day, '%y%m%d').date()
            strike = int(encoded) / 1000
        else:
            match = re.fullmatch(r'([A-Z]+)(?: US)?\s+(\d{2}/\d{2}/(?:\d{4}|\d{2}))\s+([CP])(\d+(?:\.\d+)?)', name)
            if not match:
                return None
            underlying, day, kind, strike = match.groups()
            expiry = dt.datetime.strptime(day, '%m/%d/%Y' if len(day) == 10 else '%m/%d/%y').date()
            strike = float(strike)
    if underlying not in SYMBOLS or not math.isfinite(strike) or strike <= 0 or round(strike * 100) % 25:
        return None
    quantity = number(row.get('Share Quantity'))
    if quantity is None or not math.isfinite(quantity):
        return None
    return underlying, expiry.isoformat(), kind, float(strike), quantity


def load_snapshots(history):
    snapshots = []
    manifest = []
    universe = {}
    for path in sorted(history.glob('holdings_*.csv')):
        file_day = date_value(path.stem.removeprefix('holdings_'))
        if file_day is None:
            continue
        flags = {}
        options = []
        with path.open(newline='') as handle:
            for row in csv.DictReader(handle):
                fund = row.get('ETF Ticker', '').strip()
                flag = flags.setdefault(fund, {'bad': False, 'unknown': False, 'source_dates': set()})
                source = date_value(row.get('Source_Date')) or date_value(row.get('Date'))
                refresh = str(row.get('Refreshed', '')).lower()
                flag['bad'] |= refresh in ('false', '0') or (source is not None and not 0 <= (file_day - source).days <= 3)
                flag['unknown'] |= refresh not in ('true', '1', 'false', '0') or source is None
                if source:
                    flag['source_dates'].add(source.isoformat())
                parsed = contract(row)
                if parsed is None or (source and source > file_day):
                    continue
                symbol, expiry, kind, strike, quantity = parsed
                options.append(dict(symbol=symbol, expiry=expiry, kind=kind, strike=strike, quantity=quantity, fund=fund))
                universe.setdefault((symbol, expiry, kind), set()).add(strike)
        # Freeze the accumulated, pre-cutoff observed listing universe at each file.
        snapshots.append(dict(day=file_day.isoformat(), flags=flags, options=options,
                              universe={key: sorted(value) for key, value in universe.items()}))
        manifest.append(dict(file=path.name, bytes=path.stat().st_size, sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
    return snapshots, manifest


def load_prices(path):
    payload = json.loads(path.read_text())
    result = payload['chart']['result'][0]
    # The raw quote block has no dividend adjustment. Yahoo may normalize historical
    # quotes for splits: reject a split within the analysis window instead of silently
    # comparing adjusted prices with historical option strikes.
    splits = result.get('events', {}).get('splits', {})
    if splits:
        raise ValueError(f'Historical split requires explicit price/strike normalization: {splits}')
    quotes = result['indicators']['quote'][0]
    rows = {}
    for index, timestamp in enumerate(result.get('timestamp', [])):
        day = dt.datetime.fromtimestamp(timestamp, ZoneInfo('America/New_York')).date().isoformat()
        record = {key: quotes[key][index] for key in ('open', 'high', 'low', 'close')}
        if all(value is not None and math.isfinite(value) and value > 0 for value in record.values()):
            if not record['low'] <= record['close'] <= record['high']:
                raise ValueError(f'Invalid OHLC on {day}')
            rows[day] = record
    return rows, result.get('meta', {})


def strike_step(strikes):
    values = sorted({round(value * 100) for value in strikes})
    differences = [b - a for a, b in zip(values, values[1:]) if b > a]
    return math.gcd(*differences) / 100 if differences else None


def match_strikes(book, observed, spot, threshold):
    step = strike_step(observed)
    if not step:
        return [], [], 0, None
    heavy = [k for k, v in book.items() if v['short'] - v['long'] >= threshold and abs(k / spot - 1) <= .15]
    heavy.sort(key=lambda k: (-(book[k]['short'] - book[k]['long']), k))
    controls = [k for k in observed if book.get(k, {}).get('short', 0) == 0 and abs(k / spot - 1) <= .15]
    matched, chosen = [], []
    def band(strike):
        return math.floor(((strike / spot - 1) + 1e-12) / .05)
    anchor = min(observed)
    for strike in heavy:
        eligible = [control for control in controls if control not in chosen and band(control) == band(strike)
                    and abs((control - anchor) / step - round((control - anchor) / step)) < 1e-7]
        if eligible:
            control = min(eligible, key=lambda value: (abs(value - strike), value))
            matched.append(strike)
            chosen.append(control)
    return matched, chosen, len(heavy) - len(matched), step


def metrics(strikes, price, spot, step):
    close = price['close']
    return dict(distance=min(abs(close - k) / spot for k in strikes),
                hit_one_pct=float(any(abs(close - k) / k <= .01 for k in strikes)),
                hit_half_step=float(any(abs(close - k) <= step / 2 for k in strikes)),
                range_straddle=sum(price['low'] < k < price['high'] for k in strikes) / len(strikes))


def observations(snapshots, prices, as_of, threshold=1000, kind='C', known_only=False):
    expiries = sorted({(r['symbol'], r['expiry']) for snap in snapshots for r in snap['options'] if r['kind'] == kind and r['expiry'] < as_of})
    rows, excluded = [], []
    for symbol, expiry in expiries:
        eligible = [snap for snap in snapshots if snap['day'] < expiry]
        reason = None
        if not eligible:
            reason = 'no_pre_expiry_snapshot'
        market = prices.get(symbol, {})
        prior_days = [day for day in market if day < expiry]
        if expiry not in market or not prior_days:
            reason = 'no_expiry_or_prior_session_price'
        if reason:
            excluded.append(dict(symbol=symbol, expiry=expiry, reason=reason))
            continue
        snap = eligible[-1]
        prior_day = max(prior_days)
        spot = market[prior_day]['close']
        book = {}
        used_funds = set()
        unknown = set()
        source_dates = set()
        excluded_funds = set()
        for row in snap['options']:
            if (row['symbol'], row['expiry'], row['kind']) != (symbol, expiry, kind):
                continue
            flag = snap['flags'][row['fund']]
            if flag['bad'] or (known_only and flag['unknown']):
                excluded_funds.add(row['fund'])
                continue
            used_funds.add(row['fund'])
            if flag['unknown']:
                unknown.add(row['fund'])
            source_dates.update(flag['source_dates'])
            values = book.setdefault(row['strike'], dict(short=0., long=0.))
            values['short'] += max(0, -row['quantity'])
            values['long'] += max(0, row['quantity'])
        universe = snap['universe'].get((symbol, expiry, kind), [])
        written, control, unmatched, step = match_strikes(book, universe, spot, threshold)
        if not written:
            excluded.append(dict(symbol=symbol, expiry=expiry, snapshot=snap['day'], reason='no_matched_heavy_strikes', unmatched=unmatched,
                                 excluded_funds=sorted(excluded_funds)))
            continue
        wm = metrics(written, market[expiry], spot, step)
        cm = metrics(control, market[expiry], spot, step)
        week = dt.date.fromisoformat(expiry).isocalendar()[:2]
        rows.append(dict(symbol=symbol, expiry=expiry, week=f'{week[0]}-{week[1]:02}', snapshot=snap['day'], prior_session=prior_day,
                         source_dates=sorted(source_dates), snapshot_calendar_lag=(dt.date.fromisoformat(expiry)-dt.date.fromisoformat(snap['day'])).days,
                         prior_close=spot, **market[expiry], written=written, controls=control, step=step, unmatched=unmatched,
                         funds=sorted(used_funds), unknown_freshness_funds=sorted(unknown), excluded_funds=sorted(excluded_funds),
                         written_contracts=[book[k]['short']-book[k]['long'] for k in written], written_metrics=wm, control_metrics=cm,
                         difference={key: wm[key]-cm[key] for key in wm}))
    return rows, excluded


def percentile(values, q):
    values = sorted(values)
    position = (len(values) - 1) * q
    lo = math.floor(position)
    hi = math.ceil(position)
    return values[lo] + (values[hi] - values[lo]) * (position - lo)


def inference(rows, clustered=False):
    if not rows:
        return dict(n=0, weeks=0, mean_difference=None, p_value=None, ci95=None)
    values = [row['difference']['distance'] for row in rows]
    groups = {}
    for index, row in enumerate(rows):
        key = row['week'] if clustered else str(index)
        groups.setdefault(key, []).append(row['difference']['distance'])
    blocks = list(groups.values())
    totals = [sum(block) for block in blocks]
    observed = abs(sum(values))
    rng = random.Random(SEED)
    if len(totals) <= 20:
        sums = [0.]
        for value in totals:
            sums = [x+value for x in sums] + [x-value for x in sums]
        p = sum(abs(value) >= observed-1e-12 for value in sums) / len(sums)
        method = 'exact sign-flip'
    else:
        count = sum(abs(sum(value if rng.getrandbits(1) else -value for value in totals)) >= observed-1e-12 for _ in range(100000))
        p = (count+1) / 100001
        method = '100000 Monte Carlo sign-flips'
    bootstrap = []
    for _ in range(20000):
        sample = [value for _ in blocks for value in rng.choice(blocks)]
        bootstrap.append(statistics.mean(sample))
    return dict(n=len(rows), weeks=len({row['week'] for row in rows}), mean_difference=statistics.mean(values),
                p_value=p, ci95=[percentile(bootstrap,.025), percentile(bootstrap,.975)], method=method,
                clustered=clustered, written_distance_mean=statistics.mean(row['written_metrics']['distance'] for row in rows),
                control_distance_mean=statistics.mean(row['control_metrics']['distance'] for row in rows),
                secondary={key:dict(written=statistics.mean(row['written_metrics'][key] for row in rows),
                                    control=statistics.mean(row['control_metrics'][key] for row in rows))
                           for key in ('hit_one_pct','hit_half_step','range_straddle')})


def fetch_prices(symbol, directory, start, end):
    before = int(dt.datetime.combine(start, dt.time(), dt.timezone.utc).timestamp())
    after = int(dt.datetime.combine(end, dt.time(), dt.timezone.utc).timestamp())
    url = f'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?period1={before}&period2={after}&interval=1d&events=splits%2Cdiv'
    request = urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0'})
    with urllib.request.urlopen(request, timeout=40) as response:
        raw = response.read()
    directory.mkdir(parents=True,exist_ok=True)
    path = directory / (symbol+'.json')
    if path.exists():
        raise ValueError(f'Refusing to overwrite price capture: {path}')
    path.write_bytes(raw)
    return dict(symbol=symbol,url=url,downloaded_utc=dt.datetime.now(dt.timezone.utc).isoformat(),sha256=hashlib.sha256(raw).hexdigest())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--history', type=Path, default=ROOT/'etf-dashboard/public/data/history')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--prices-dir', type=Path)
    parser.add_argument('--fetch-prices', action='store_true')
    parser.add_argument('--as-of', default='2026-10-15', help='Exclusive expiry cutoff, fixed for preregistered snapshot')
    args = parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    snapshots, manifest = load_snapshots(args.history)
    price_dir = args.prices_dir or args.output/'prices'
    downloads = []
    if args.fetch_prices:
        first = dt.date.fromisoformat(snapshots[0]['day'])-dt.timedelta(days=14)
        for symbol in SYMBOLS:
            downloads.append(fetch_prices(symbol,price_dir,first,dt.date.fromisoformat(args.as_of)))
        (args.output/'price_manifest.json').write_text(json.dumps(downloads,indent=2)+'\n')
    prices = {symbol:load_prices(price_dir/(symbol+'.json'))[0] for symbol in SYMBOLS}
    primary, excluded = observations(snapshots,prices,args.as_of)
    price_inputs = [dict(symbol=symbol, file=symbol+'.json', sha256=hashlib.sha256((price_dir/(symbol+'.json')).read_bytes()).hexdigest(),
                         metadata=load_prices(price_dir/(symbol+'.json'))[1]) for symbol in SYMBOLS]
    results = dict(as_of=args.as_of, seed=SEED, files=len(snapshots), history_manifest=manifest, price_inputs=price_inputs,
                   rows=primary, exclusions=excluded, by_symbol={symbol:inference([r for r in primary if r['symbol']==symbol]) for symbol in SYMBOLS},
                   by_symbol_clustered={symbol:inference([r for r in primary if r['symbol']==symbol],True) for symbol in SYMBOLS},
                   pooled=inference(primary,True), sensitivities={})
    for threshold,kind,label in [(100,'C','calls100'),(500,'C','calls500'),(5000,'C','calls5000'),(1000,'P','puts1000')]:
        rows, exc = observations(snapshots,prices,args.as_of,threshold,kind)
        results['sensitivities'][label]=dict(n=len(rows),by_symbol={symbol:dict(n=sum(r['symbol']==symbol for r in rows),
            mean_difference=statistics.mean([r['difference']['distance'] for r in rows if r['symbol']==symbol]) if any(r['symbol']==symbol for r in rows) else None) for symbol in SYMBOLS},exclusions=exc)
    known,_ = observations(snapshots,prices,args.as_of,known_only=True)
    results['known_freshness_only']=dict(by_symbol={symbol:inference([r for r in known if r['symbol']==symbol]) for symbol in SYMBOLS},pooled=inference(known,True))
    out=args.output/'results.json';out.write_text(json.dumps(results,indent=2,allow_nan=False)+'\n')
    print(json.dumps(dict(by_symbol=results['by_symbol'],pooled=results['pooled']),indent=2))

if __name__=='__main__':
    main()
