"""Separate, sync-triggered worker: never started in either uvicorn process."""
import fcntl
import hashlib
import json
import time
import uuid
from datetime import date
from pathlib import Path

from . import data, notification_store as store, push_delivery


def build_events(day):
    """Guarded active deltas only; an unavailable book is not an exit."""
    current, previous = data.get_latest_holdings(), data.get_previous_holdings()
    by_fund = [{}, {}]
    for rows, grouped in zip((current, previous), by_fund):
        for row in rows:
            grouped.setdefault(row.get('ETF Ticker'), []).append(row)
    eligible = set(by_fund[0]) & set(by_fund[1])
    for fund in list(eligible):
        if any(not data.row_file_date(r) or data.row_refreshed(r) is False or data.is_stale(data.row_file_date(r), day)
               for book in by_fund for r in book[fund]):
            eligible.remove(fund)
    events = []
    # This shared function implements catch-up, price drift, splits and junk exclusion.
    for change in data.compute_daily_changes():
        fund, delta = change['fund'], change['activeWeightDelta']
        if fund not in eligible or abs(delta) < data._significance_threshold(fund):
            continue
        action = ('opened' if change['type'] == 'NEW' else
                  'closed' if change['type'] == 'REMOVED' else
                  'added to' if delta > 0 else 'trimmed')
        overlay = data.get_fund_category(fund) == 'option-income'
        label = ' (overlay/collateral activity)' if overlay else ''
        events.append({'kind': 'trade', 'fund': fund, 'ticker': change['ticker'],
                       'activeWeightDelta': delta, 'type': change['type'], 'overlay': overlay,
                       'text': f"{fund} {action} {change['ticker']} ({delta:+.2f} pp){label}"})
    for fund, since in data.get_catch_up_funds().items():
        # Only a follow of this fund receives its refresh notice; never a ticker trade.
        if any(not data.row_file_date(r) or data.is_stale(data.row_file_date(r), day) or data.row_refreshed(r) is False
               for r in by_fund[0][fund]):
            continue
        since_text = date.fromisoformat(since).strftime('%b %d').replace(' 0', ' ') if since else 'the previous disclosure'
        events.append({'kind': 'catch-up', 'fund': fund, 'since': since,
                       'text': f'{fund} has refreshed: changes since {since_text} are not daily moves'})
    return events


def build_digest(device_id, follows, day, events, digest_id):
    funds = {f['symbol'] for f in follows if f['kind'] == 'fund'}
    tickers = {f['symbol'] for f in follows if f['kind'] == 'ticker'}
    selected = [e for e in events if e['fund'] in funds or
                (e['kind'] == 'trade' and not e['overlay'] and e['ticker'] in tickers)]
    body = '; '.join(e['text'] for e in selected[:3])
    if len(selected) > 3:
        body += f"; +{len(selected)-3} more updates"
    return selected, {'title': f'TickerTrace · {day}', 'body': body,
                      'data': {'digestId': digest_id, 'snapshotDate': day, 'url': 'https://tickertrace.pro/holdings'}}


def _signature(paths):
    result = hashlib.sha256()
    for path in paths:
        result.update(path.name.encode()); result.update(path.read_bytes())
    return result.hexdigest()


def prepare_daily(now):
    day = data.get_as_of_date()
    if not day or data._parse_iso(day) is None or not data._is_trading_day(day):
        return 0
    dates = data.get_available_dates()
    if len(dates) < 2:
        return 0
    paths = [Path(data.HISTORY_DIR) / f'holdings_{d}.csv' for d in dates[:2]]
    with store.connect() as db:
        if db.execute('SELECT 1 FROM source_runs WHERE day=?', (day,)).fetchone():
            return 0
    signature = _signature(paths)
    events = build_events(day)
    if data.get_available_dates()[:2] != dates[:2] or _signature(paths) != signature:
        raise RuntimeError('Snapshot changed during digest preparation; retry next sync')
    count = 0
    with store.connect() as db:
        db.execute('BEGIN IMMEDIATE')
        if db.execute('SELECT 1 FROM source_runs WHERE day=?', (day,)).fetchone():
            return 0
        for device in db.execute('SELECT id FROM devices').fetchall():
            follows = [dict(r) for r in db.execute('SELECT kind,symbol FROM follows WHERE device_id=?', (device['id'],))]
            digest_id = str(uuid.uuid4())
            selected, payload = build_digest(device['id'], follows, day, events, digest_id)
            db.execute('INSERT INTO outbox(id,device_id,day,events,payload,status,created,next_attempt) VALUES(?,?,?,?,?,?,?,?)',
                       (digest_id, device['id'], day, json.dumps(selected), json.dumps(payload),
                        'pending' if selected else 'empty', now, now))
            count += bool(selected)
        db.execute('INSERT INTO source_runs VALUES(?,?,?)', (day, signature, now))
    return count


def _prune(db, row, error):
    if error == 'DeviceNotRegistered':
        db.execute('DELETE FROM devices WHERE id=?', (row['device_id'],))
        return True
    return False


def send_pending(now):
    sent = 0
    # Limit one cron invocation; subsequent syncs drain the remainder.
    for _ in range(200):
        with store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute("UPDATE outbox SET status='failed',error='attempts_exhausted' WHERE status IN ('pending','sending') AND attempts>=5 AND lease_until<=?", (now,))
            db.execute("UPDATE outbox SET status='expired' WHERE status IN ('pending','sending') AND created<?", (now-86400,))
            row = db.execute("SELECT o.*,d.token FROM outbox o JOIN devices d ON d.id=o.device_id WHERE (o.status='pending' OR (o.status='sending' AND o.lease_until<=?)) AND o.next_attempt<=? ORDER BY o.created LIMIT 1", (now, now)).fetchone()
            if not row:
                break
            db.execute("UPDATE outbox SET status='sending',attempts=attempts+1,lease_until=? WHERE id=?", (now+120, row['id']))
        # Recheck cancellation/deletion immediately before external delivery.
        with store.connect() as db:
            active = db.execute("SELECT o.status,d.token FROM outbox o JOIN devices d ON d.id=o.device_id WHERE o.id=?", (row['id'],)).fetchone()
        if not active or active['status'] != 'sending' or active['token'] != row['token']:
            continue
        error, retryable, ticket = None, False, None
        try:
            result = push_delivery.send_expo(row['token'], json.loads(row['payload']))
            if result.get('status') == 'ok' and result.get('id'):
                ticket = result['id']
            else:
                error = result.get('details', {}).get('error', 'invalid_ticket')
                retryable = error == 'MessageRateExceeded'
        except push_delivery.PushError as e:
            error, retryable = str(e), e.retryable
        with store.connect() as db:
            # Ignore an old result after unsubscribe or authenticated token replacement.
            valid = db.execute("SELECT 1 FROM outbox o JOIN devices d ON d.id=o.device_id WHERE o.id=? AND o.status='sending' AND d.token=?", (row['id'],row['token'])).fetchone()
            if not valid or (error and _prune(db, row, error)):
                continue
            if ticket:
                db.execute("UPDATE outbox SET status='accepted',ticket=?,ticket_at=?,lease_until=0 WHERE id=?", (ticket,now,row['id']))
                sent += 1
            else:
                attempts = row['attempts'] + 1
                retry = retryable and attempts < 5
                db.execute('UPDATE outbox SET status=?,error=?,next_attempt=?,lease_until=0 WHERE id=?',
                           ('pending' if retry else 'failed', error, now+min(900*2**(attempts-1),14400), row['id']))
    return sent


def poll_receipts(now):
    with store.connect() as db:
        rows = db.execute("SELECT * FROM outbox WHERE status='accepted' AND ticket_at<=? LIMIT 1000", (now-900,)).fetchall()
    if not rows:
        return 0
    try:
        receipts = push_delivery.get_receipts([r['ticket'] for r in rows])
    except push_delivery.PushError:
        return 0
    checked = 0
    with store.connect() as db:
        for row in rows:
            receipt = receipts.get(row['ticket'])
            # Recheck status: a receipt for an old token must not delete its replacement.
            if not db.execute("SELECT 1 FROM outbox WHERE id=? AND status='accepted'", (row['id'],)).fetchone():
                continue
            if not receipt:
                if now-row['ticket_at'] >= 86400:
                    db.execute("UPDATE outbox SET status='receipt_missing' WHERE id=?", (row['id'],))
                continue
            error = receipt.get('details', {}).get('error')
            if not _prune(db, row, error):
                db.execute('UPDATE outbox SET status=?,error=? WHERE id=?',
                           ('delivered' if receipt.get('status') == 'ok' else 'failed', error, row['id']))
            checked += 1
    return checked


def queue_test(device_id, now=None):
    now = time.time() if now is None else now
    digest_id = str(uuid.uuid4())
    payload = {'title': 'TickerTrace test', 'body': 'Daily watchlist notifications are connected.',
               'data': {'digestId': digest_id, 'test': True}}
    with store.connect() as db:
        db.execute('INSERT INTO outbox(id,device_id,day,events,payload,status,created,next_attempt) VALUES(?,?,?,?,?,?,?,?)',
                   (digest_id,device_id,'test:'+digest_id,'[]',json.dumps(payload),'pending',now,now))
    return digest_id


def run_once(now=None):
    if not store.enabled():
        return {'enabled': False}
    now = time.time() if now is None else now
    store.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Kernel releases lock on crash; SQLite unique constraints/leases protect outbox too.
    with open(store.DB_PATH.with_suffix('.lock'), 'a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {'enabled': True, 'busy': True}
        receipts = poll_receipts(now)
        prepared = prepare_daily(now)
        sent = send_pending(now)
        with store.connect() as db:
            db.execute('DELETE FROM outbox WHERE created<?', (now-30*86400,))
            db.execute('DELETE FROM enrollments WHERE bucket<?', (int(now // 86400),))
            db.execute('DELETE FROM source_runs WHERE created<?', (now-180*86400,))
            db.execute('DELETE FROM devices WHERE updated<?', (now-180*86400,))
        return {'enabled': True, 'prepared': prepared, 'accepted': sent, 'receipts': receipts}


if __name__ == '__main__':
    print(json.dumps(run_once()))  # Counts only: no tokens, bearer secrets or follow lists.
