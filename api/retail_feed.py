"""Hourly anonymous ticker-lookup counts for Trader Matrix's retail-signal dataset.

Spec: TraderDaddy-Pro---Whop/reference/retail-signal/tickertrace-feed.md
Per ticker, per window: `count` (total lookups) and `authors` (distinct users). Distinct users are tracked as
salted hashes in memory only, cleared after a successful send; nothing here touches disk. Tickers under 3
distinct users are never sent. Off unless TICKERTRACE_INGEST_SECRET is set. The secret is never committed.
"""
import json
import os
import threading
import urllib.request
import urllib.error

URL = os.getenv('RETAIL_FEED_URL', 'https://api.tradermatrix.pro/api/retail-signal/tickertrace')
MIN_USERS = 3
MAX_TICKERS = 20000
SEND_EVERY_SEC = 3600


class Window:
    def __init__(self):
        self.lock = threading.Lock()
        self.data = {}  # ticker -> [count, set(user_hash)]

    def add(self, ticker, user_hash):
        # ponytail: lock-free would be faster; one short lock is fine at this volume
        with self.lock:
            if ticker not in self.data and len(self.data) >= MAX_TICKERS:
                return
            row = self.data.setdefault(ticker, [0, set()])
            row[0] += 1
            row[1].add(user_hash)

    def items(self):
        with self.lock:
            return [{'ticker': t, 'count': c, 'authors': len(u)} for t, (c, u) in sorted(self.data.items())
                    if len(u) >= MIN_USERS]

    def clear(self):
        with self.lock:
            self.data = {}


window = Window()


def post(items, secret, url=URL):
    """Return the HTTP status, or 0 for a network failure."""
    req = urllib.request.Request(url, json.dumps({'items': items}).encode(), {
        'Authorization': f'Bearer {secret}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return 0


def send_once(secret, sender=post):
    """Send the window. Clear it only on 2xx; otherwise keep it so the next hour's send includes it.
    Never resend a request that landed: there is no batch id, so a repeat counts twice."""
    items = window.items()
    if not items:
        window.clear()  # nothing over the floor; drop the sub-3 sets too
        return None
    status = sender(items, secret)
    if 200 <= status < 300:
        window.clear()
    return status


# ponytail: a 200 with ok:false (some items failed) is treated as sent; the reply does not say which items
# failed, so a partial resend is not possible. Ask the TraderMatrix side to return the failed tickers if needed.
def start(stop_event):
    secret = os.getenv('TICKERTRACE_INGEST_SECRET')
    if not secret:
        return None

    def run():
        while not stop_event.wait(SEND_EVERY_SEC):
            try:
                send_once(secret)
            except Exception:
                pass  # a feed problem can never affect the API
    t = threading.Thread(target=run, name='retail-feed', daemon=True)
    t.start()
    return t
