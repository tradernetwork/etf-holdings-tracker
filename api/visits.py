"""
Lightweight public visit tracker.

POST /api/v1/visits/track   — fired on every page load by the browser
GET  /api/v1/visits/live    — returns the current counts for the footer pill

Storage: Postgres (Supabase, `tickertrace` schema) — tickertrace.visit_events
/ tickertrace.visit_meta. Migrated off the old per-file SQLite DB for the
Railway move (Sep 2026): local disk on Vultr doesn't survive a Railway
deploy. This module keeps its own small connection pool, separate from
api/auth.py's — it was already a fully self-contained module with no
dependency on auth.py, and pageview writes are a different (higher-volume,
lower-value-per-row) access pattern than the auth tables, so there's no
reason to couple the two. Every query is schema-qualified with
`tickertrace.` — see api/auth.py's module docstring for why (this Postgres
instance also hosts an unrelated product's live billing tables in `public`).

  visit_events  — one row per pageview, ~30-day retention
  visit_meta    — key/value: lifetime_visits counter, last_prune_ts

"Live now" is the count of distinct visitor hashes seen in the last 5
minutes. Today / week / all-time are simple COUNT(*) queries over the
events table (+ the lifetime counter for all-time, which survives pruning).

Visitor identity is sha256(ip + server_salt)[:16]. The IP itself is never
persisted — only the hash — so the table is GDPR-friendly out of the box.

NOTE on where `ip` comes from: record() trusts whatever the caller passes
in. See api/server.py's track_visit() handler for a real bug this migration
fixes — behind Apache's ProxyPass on the old Vultr box, the caller was
passing get_remote_address(request) (== request.client.host), which is
ALWAYS 127.0.0.1 behind that proxy. Every visitor — bot or human — has
collapsed into the exact same visitor_hash for the entire life of this
feature, silently. Railway has no Apache in front (Railway's edge terminates
TLS and sets X-Forwarded-For itself), so the fix belongs at that call site,
not in this module.
"""

from __future__ import annotations

import hashlib
import os
import threading
import time
from contextlib import contextmanager
from typing import Iterator, Optional

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

# Salt randomizes the IP hash; rotating it would shuffle "live now"
# cardinality but doesn't matter for correctness. A stable env-provided
# salt prevents trivial reverse-lookup if the DB were ever leaked.
SALT = os.getenv('VISIT_HASH_SALT', 'tickertrace-default-salt-2026')
LIVE_WINDOW_SEC = 5 * 60
PRUNE_AFTER_DAYS = 30
PRUNE_EVERY_SEC = 6 * 3600  # at most every 6h on the request path

_pool: Optional[ConnectionPool] = None
_pool_lock = threading.Lock()
_schema_ready = False
_schema_lock = threading.Lock()


def _get_pool() -> ConnectionPool:
    """Lazily create the pool on first use (mirrors auth.py) — not at import
    time, since DATABASE_URL may not be set yet (e.g. static syntax checks)."""
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                dsn = os.environ.get("DATABASE_URL")
                if not dsn:
                    raise RuntimeError(
                        "DATABASE_URL environment variable is required "
                        "(Postgres connection string for the tickertrace schema)"
                    )
                _pool = ConnectionPool(
                    conninfo=dsn,
                    min_size=1,
                    max_size=5,
                    # See api/auth.py's _get_pool() for why: Supavisor
                    # transaction-mode pooling doesn't support server-side
                    # prepared statements.
                    kwargs={"row_factory": dict_row, "prepare_threshold": None},
                    open=True,
                )
    return _pool


def close_pool() -> None:
    """Close this module's pool. Provided for symmetry with
    auth.close_all_connections(); not currently wired into FastAPI lifespan
    (only auth's pool is closed there today)."""
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


@contextmanager
def _conn() -> Iterator[psycopg.Connection]:
    """Per-call pooled connection. Commits on success, rolls back on error
    (same contract as auth.py's tx())."""
    global _schema_ready
    if not _schema_ready:
        with _schema_lock:
            if not _schema_ready:
                _ensure_schema()
                _schema_ready = True
    with _get_pool().connection() as conn:
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise


def _ensure_schema() -> None:
    """Verify tickertrace.visit_events / visit_meta are reachable.

    Does NOT attempt to create them. This module connects as `tickertrace_app`,
    a role scoped to USAGE + CRUD on this schema's existing objects only, with
    no CREATE privilege on the database (see api/auth.py's init_db() for the
    full reasoning — same isolation, same restriction). A CREATE TABLE IF NOT
    EXISTS here fails with `permission denied for database postgres` on every
    call (confirmed live), so this checks existence instead."""
    with _get_pool().connection() as conn:
        row = conn.execute(
            "SELECT to_regclass('tickertrace.visit_events') IS NOT NULL AS ok"
        ).fetchone()
        if not row["ok"]:
            raise RuntimeError(
                "tickertrace.visit_events not found — has the schema "
                "migration been applied to this database?"
            )


def _visitor_hash(ip: str) -> str:
    digest = hashlib.sha256(f'{ip}|{SALT}'.encode()).hexdigest()
    return digest[:16]


def record(ip: str, path: str = '') -> None:
    """Record a single pageview. Also kicks off a background prune if it's
    been a while. Caller is responsible for rate limiting upstream."""
    now = int(time.time())
    vh = _visitor_hash(ip)
    path = (path or '')[:120]  # cap path length to avoid runaway storage
    with _conn() as c:
        c.execute(
            'INSERT INTO tickertrace.visit_events (ts, visitor_hash, path) VALUES (%s, %s, %s)',
            (now, vh, path),
        )
        c.execute(
            'UPDATE tickertrace.visit_meta SET value = value + 1 WHERE key = %s',
            ('lifetime_visits',),
        )
        # Cheap, infrequent retention prune.
        row = c.execute(
            'SELECT value FROM tickertrace.visit_meta WHERE key = %s',
            ('last_prune_ts',),
        ).fetchone()
        last_prune = row['value'] if row else 0
        if now - last_prune > PRUNE_EVERY_SEC:
            cutoff = now - PRUNE_AFTER_DAYS * 86400
            c.execute('DELETE FROM tickertrace.visit_events WHERE ts < %s', (cutoff,))
            c.execute(
                'UPDATE tickertrace.visit_meta SET value = %s WHERE key = %s',
                (now, 'last_prune_ts'),
            )


def live_counts() -> dict:
    """Return the snapshot rendered by the footer pill."""
    now = int(time.time())
    # Compute "today" as the events table's idea of midnight (UTC). The pill
    # is approximate; precision doesn't matter and timezone drift is OK.
    midnight_utc = now - (now % 86400)
    week_ago = now - 7 * 86400
    live_floor = now - LIVE_WINDOW_SEC
    with _conn() as c:
        live_row = c.execute(
            'SELECT COUNT(DISTINCT visitor_hash) AS n FROM tickertrace.visit_events WHERE ts > %s',
            (live_floor,),
        ).fetchone()
        today_row = c.execute(
            'SELECT COUNT(*) AS n FROM tickertrace.visit_events WHERE ts >= %s',
            (midnight_utc,),
        ).fetchone()
        week_row = c.execute(
            'SELECT COUNT(*) AS n FROM tickertrace.visit_events WHERE ts >= %s',
            (week_ago,),
        ).fetchone()
        lifetime_row = c.execute(
            'SELECT value FROM tickertrace.visit_meta WHERE key = %s',
            ('lifetime_visits',),
        ).fetchone()
    return {
        'now': int(live_row['n'] or 0) if live_row else 0,
        'today': int(today_row['n'] or 0) if today_row else 0,
        'week': int(week_row['n'] or 0) if week_row else 0,
        'allTime': int(lifetime_row['value'] or 0) if lifetime_row else 0,
        'asOf': now,
    }
