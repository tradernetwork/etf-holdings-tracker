"""
Operator tooling for the notifications go-live test. Runs INSIDE the api container:

    docker compose exec -T api python -m api.notification_ops status
    docker compose exec -T api python -m api.notification_ops queue-test        # exactly one device registered
    docker compose exec -T api python -m api.notification_ops queue-test --device 1a2b3c4d
    docker compose exec -T api python -m api.notification_ops purge --yes       # delete every device + its data
    docker compose exec -T api python -m api.notification_ops purge --device 1a2b3c4d --yes   # delete one device

Nothing here sends a push: `queue-test` only queues the fixed test message, which the normal worker
(`python -m api.notification_job`, run by the 15-minute sync hook) delivers. Output never contains a
push token, a bearer secret or a follow list: only counts, short ids and a 4-character token tail.
"""
import argparse
import sys
import time

from . import notification_store as store


def _mask(token):
    return f'…{token[-5:-1]}' if token else '—'


def status():
    out = [f'notifications enabled: {store.enabled()}']
    with store.connect() as db:
        devices = db.execute('SELECT id, token, created, updated FROM devices ORDER BY created').fetchall()
        out.append(f'devices: {len(devices)}')
        for d in devices:
            follows = db.execute('SELECT COUNT(*) FROM follows WHERE device_id=?', (d['id'],)).fetchone()[0]
            age = int((time.time() - d['created']) // 60)
            out.append(f'- device {d["id"][:8]} token {_mask(d["token"])} follows {follows} registered {age} min ago')
            for r in db.execute('SELECT day, status, attempts, error FROM outbox WHERE device_id=? ORDER BY created DESC LIMIT 5', (d['id'],)):
                out.append(f'    outbox {r["day"][:24]:24} {r["status"]:10} attempts={r["attempts"]}' + (f' error={r["error"]}' if r['error'] else ''))
        last = db.execute('SELECT day, created FROM source_runs ORDER BY created DESC LIMIT 1').fetchone()
        out.append(f'last digest run: {last["day"] if last else "none yet"}')
    return '\n'.join(out)


def _pick(db, prefix):
    rows = db.execute('SELECT id FROM devices').fetchall()
    if prefix:
        rows = [r for r in rows if r['id'].startswith(prefix)]
    if len(rows) != 1:
        raise SystemExit(f'expected exactly one device, found {len(rows)}; pass --device <id prefix> (see `status`)')
    return rows[0]['id']


def queue_test(prefix=None):
    from .notification_job import queue_test as _queue
    with store.connect() as db:
        device_id = _pick(db, prefix)
    return device_id, _queue(device_id)


def purge(prefix=None):
    """Delete every device (or the one whose id starts with `prefix`); follows, outbox and quotas cascade."""
    with store.connect() as db:
        if prefix:
            ids = [r['id'] for r in db.execute('SELECT id FROM devices') if r['id'].startswith(prefix)]
            if len(ids) != 1:
                raise SystemExit(f'expected exactly one device for prefix {prefix!r}, found {len(ids)}')
            db.execute('DELETE FROM devices WHERE id=?', (ids[0],))
            return 1
        n = db.execute('SELECT COUNT(*) FROM devices').fetchone()[0]
        db.execute('DELETE FROM devices')
    return n


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('status')
    q = sub.add_parser('queue-test')
    q.add_argument('--device')
    p = sub.add_parser('purge')
    p.add_argument('--yes', action='store_true')
    p.add_argument('--device', help='only the device whose id starts with this prefix (see `status`)')
    a = ap.parse_args(argv)
    if a.cmd == 'status':
        print(status())
    elif a.cmd == 'queue-test':
        did, digest = queue_test(a.device)
        print(f'queued test digest {digest[:8]} for device {did[:8]}; the next worker run (sync hook, <= 15 min) sends it')
    elif a.cmd == 'purge':
        if not a.yes:
            raise SystemExit('refusing without --yes')
        print(f'deleted {purge(a.device)} device(s) and all their follows / outbox rows')
    return 0


if __name__ == '__main__':
    sys.exit(main())
