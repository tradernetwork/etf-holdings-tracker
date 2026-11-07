#!/usr/bin/env python3
"""
Fetch YieldMax's published intraday trade file and merge it into
etf-dashboard/public/data/trades/trades_YYYY-MM-DD.csv.

Run by .github/workflows/scrape.yml as a NON-FATAL step: a provider outage or a
format change must never block the daily holdings commit, so every failure path
here logs and exits 0. Format drift is surfaced by the `rejected` counts in the
log line instead of by a red build.

The provider's page answers one of two ways — a direct CSV, or an HTML page that
embeds the CSV in an <iframe> — so the fetcher branches on Content-Type.

    python scripts/scrape_intraday_trades.py            # fetch + merge
    python scripts/scrape_intraday_trades.py --file x.csv   # merge a local file
"""

from __future__ import annotations

import argparse
import csv
import io
import os
import sys
from urllib.parse import urljoin

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api import trades as T  # noqa: E402

INTRADAY_PAGE = 'https://www.yieldmaxetfs.com/ym/intraday-file'
UA = 'Mozilla/5.0 (compatible; TickerTrace/1.0; +https://tickertrace.pro)'


def fetch_csv_text(get=None, url: str = INTRADAY_PAGE) -> str:
    """Return the trade file's CSV text. ``get`` is injectable for tests."""
    if get is None:
        import requests
        get = lambda u: requests.get(u, headers={'User-Agent': UA}, timeout=30, allow_redirects=True)  # noqa: E731
    r = get(url)
    r.raise_for_status()
    ctype = (r.headers.get('content-type') or '').lower()
    if 'csv' in ctype or 'text/plain' in ctype:
        return r.text
    if 'html' in ctype:
        from bs4 import BeautifulSoup
        frame = BeautifulSoup(r.text, 'html.parser').find('iframe', src=True)
        if frame is None:
            raise RuntimeError('intraday page is HTML but has no <iframe src>')
        inner = get(urljoin(url, frame['src']))
        inner.raise_for_status()
        return inner.text
    raise RuntimeError(f'unexpected content-type {ctype!r}')


def ingest(text: str, trades_dir: str | None = None) -> dict:
    reader = csv.DictReader(io.StringIO(text.lstrip('﻿')))
    rows = list(reader)
    trades, rejected = T.parse_trades(rows)
    added = T.write_trades(trades, trades_dir)
    return {'rows': len(rows), 'parsed': len(trades), 'rejected': rejected,
            'added': {d: n for d, n in added.items() if n}}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--file', help='merge a local CSV instead of fetching')
    args = ap.parse_args(argv)
    try:
        text = open(args.file, encoding='utf-8-sig').read() if args.file else fetch_csv_text()
        s = ingest(text)
    except Exception as e:  # noqa: BLE001 — fail soft by design, see module docstring
        print(f'[intraday-trades] skipped: {type(e).__name__}: {e}')
        return 0
    print(f"[intraday-trades] rows={s['rows']} parsed={s['parsed']} "
          f"new={sum(s['added'].values())} rejected={s['rejected'] or 0}")
    if s['rows'] and not s['parsed']:
        print('[intraday-trades] WARNING: file had rows but none parsed — provider format may have changed')
    return 0


if __name__ == '__main__':
    sys.exit(main())
