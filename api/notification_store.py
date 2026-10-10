"""Lazy, private SQLite state in Compose's persistent read-write api/data mount."""
import hashlib
import hmac
import os
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(__file__).parent / 'data' / 'notifications.db'


def enabled():
    return os.getenv('NOTIFICATIONS_ENABLED', '0') == '1'


@contextmanager
def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=10)
    os.chmod(DB_PATH, 0o600)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    db.execute('PRAGMA journal_mode=WAL')
    db.executescript('''
        CREATE TABLE IF NOT EXISTS devices (
            id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL UNIQUE,
            token TEXT NOT NULL UNIQUE, created REAL NOT NULL, updated REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS follows (
            device_id TEXT REFERENCES devices(id) ON DELETE CASCADE,
            kind TEXT NOT NULL, symbol TEXT NOT NULL,
            PRIMARY KEY(device_id, kind, symbol));
        CREATE TABLE IF NOT EXISTS source_runs (
            day TEXT PRIMARY KEY, signature TEXT NOT NULL, created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS outbox (
            id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
            day TEXT NOT NULL, events TEXT NOT NULL, payload TEXT NOT NULL,
            status TEXT NOT NULL, created REAL NOT NULL, next_attempt REAL NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0, lease_until REAL NOT NULL DEFAULT 0,
            ticket TEXT, ticket_at REAL, error TEXT,
            UNIQUE(device_id, day));
        CREATE TABLE IF NOT EXISTS enrollments (
            token_hash TEXT NOT NULL, bucket INTEGER NOT NULL, count INTEGER NOT NULL,
            PRIMARY KEY(token_hash,bucket));
        CREATE TABLE IF NOT EXISTS quotas (
            device_id TEXT REFERENCES devices(id) ON DELETE CASCADE,
            action TEXT NOT NULL, bucket INTEGER NOT NULL, count INTEGER NOT NULL,
            PRIMARY KEY(device_id,action,bucket));
    ''')
    try:
        with db:
            yield db
    finally:
        db.close()


class QuotaExceeded(Exception):
    pass


def create_device(token):
    secret = secrets.token_urlsafe(32)
    device_id = str(uuid.uuid4())
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        bucket = int(time.time() // 86400)
        quota = db.execute('SELECT count FROM enrollments WHERE token_hash=? AND bucket=?', (token_hash,bucket)).fetchone()
        if quota and quota['count'] >= 5:
            raise QuotaExceeded()
        db.execute('DELETE FROM enrollments WHERE bucket<?', (bucket,))
        db.execute('INSERT INTO enrollments VALUES(?,?,1) ON CONFLICT(token_hash,bucket) DO UPDATE SET count=count+1', (token_hash,bucket))
        # Reinstall recovery: new credentials, no access to the previous follows.
        db.execute('DELETE FROM devices WHERE token=?', (token,))
        db.execute('INSERT INTO devices VALUES(?,?,?,?,?)',
                   (device_id, hashlib.sha256(secret.encode()).hexdigest(), token, time.time(), time.time()))
    return {'deviceId': device_id, 'secret': secret}


def authorize(secret):
    digest = hashlib.sha256(secret.encode()).hexdigest()
    with connect() as db:
        row = db.execute('SELECT id,secret_hash FROM devices WHERE secret_hash=?', (digest,)).fetchone()
        if row and hmac.compare_digest(row['secret_hash'], digest):
            db.execute('UPDATE devices SET updated=? WHERE id=?', (time.time(), row['id']))
            return row['id']
    return None


def replace_token(device_id, token):
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        existing = db.execute('SELECT token FROM devices WHERE id=?', (device_id,)).fetchone()
        if existing and existing['token'] == token:
            return
        db.execute('UPDATE devices SET token=? WHERE id=?', (token, device_id))
        # An old ticket must not prune a newly rotated token.
        db.execute("UPDATE outbox SET status='cancelled' WHERE device_id=? AND status NOT IN ('empty','delivered','failed')", (device_id,))


def replace_follows(device_id, follows):
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        previous = {(r['kind'], r['symbol']) for r in db.execute('SELECT kind,symbol FROM follows WHERE device_id=?', (device_id,))}
        if previous == {(f['kind'], f['symbol']) for f in follows}:
            return
        db.execute('DELETE FROM follows WHERE device_id=?', (device_id,))
        db.executemany('INSERT OR IGNORE INTO follows VALUES(?,?,?)',
                       [(device_id, f['kind'], f['symbol']) for f in follows])
        # Don't send a frozen digest after the user changes/removes its follows.
        db.execute("UPDATE outbox SET status='cancelled' WHERE device_id=? AND status IN ('pending','sending')", (device_id,))


def list_follows(device_id):
    with connect() as db:
        return [dict(r) for r in db.execute('SELECT kind,symbol FROM follows WHERE device_id=? ORDER BY kind,symbol', (device_id,))]


def delete_device(device_id):
    with connect() as db:
        db.execute('DELETE FROM devices WHERE id=?', (device_id,))


def quota(device_id, action, limit, seconds, now=None):
    """Cross-worker write/test limits, independent of SlowAPI's per-IP counters."""
    bucket = int((time.time() if now is None else now) // seconds)
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        row = db.execute('SELECT count FROM quotas WHERE device_id=? AND action=? AND bucket=?', (device_id, action, bucket)).fetchone()
        if row and row['count'] >= limit:
            return False
        db.execute('INSERT INTO quotas VALUES(?,?,?,1) ON CONFLICT(device_id,action,bucket) DO UPDATE SET count=count+1', (device_id,action,bucket))
        db.execute('DELETE FROM quotas WHERE device_id=? AND action=? AND bucket<?', (device_id,action,bucket))
    return True
