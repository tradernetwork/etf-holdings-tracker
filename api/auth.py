"""
TickerTrace auth + user management.

Postgres (Supabase, `tickertrace` schema) for users, API keys, and (legacy)
subscription tracking. Firebase/Stripe were removed May 2026; the schema
retains stripe_customer_id / stripe_subscription_id columns so existing rows
don't break.

Migrated off SQLite for the Railway move (Sep 2026): the SQLite file lived on
the Vultr box's local disk, which doesn't survive a Railway deploy. Postgres
lives in a Supabase project that ALSO hosts an unrelated product's live
billing data in its `public` schema — every table here is created in, and
every query below explicitly qualifies, the dedicated `tickertrace` schema
so there is never any ambiguity (or accidental search-path bleed) about
which schema a statement touches.

Connection strategy:
    A small `psycopg_pool.ConnectionPool` (2-10 connections — this app has
    ~8 users and light traffic) replaces the old thread-local SQLite
    connection. The pool itself is created lazily on first use (mirrors the
    old lazy-open-on-first-use thread-local connection) rather than at
    import time. `tx()` is a transactional context manager: commits on
    success, rolls back on exception — same contract the old thread-local
    `tx()` had, just backed by a pooled Postgres connection instead of a
    thread-local SQLite one. `close_all_connections()` closes the pool and
    is called from FastAPI's lifespan shutdown (api/server.py).
"""

import os
import secrets
import threading
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from typing import Optional, Iterator

import bcrypt
import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

# ─── Connection pool ──────────────────────────────────────────────
_pool: Optional[ConnectionPool] = None
_pool_lock = threading.Lock()


def _get_pool() -> ConnectionPool:
    """Return the process-wide connection pool, opening it lazily on first
    use (not at import time — there may be no DATABASE_URL yet, e.g. during
    a `python -c "import ast; ..."` style syntax check)."""
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
                    min_size=2,
                    max_size=10,
                    # prepare_threshold=None disables psycopg's client-side
                    # statement autoprepare. DATABASE_URL points at Supabase's
                    # Supavisor pooler in transaction mode, which does not
                    # support server-side prepared statements (a statement
                    # prepared on one pooled backend connection may not exist
                    # on whichever backend a later query gets routed to) —
                    # see https://github.com/orgs/supabase/discussions/28239.
                    kwargs={"row_factory": dict_row, "prepare_threshold": None},
                    open=True,
                )
    return _pool


@contextmanager
def tx() -> Iterator[psycopg.Connection]:
    """Transactional context manager. Commits on success, rolls back on error."""
    with _get_pool().connection() as conn:
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise


def close_all_connections() -> None:
    """Close the pool. Called from FastAPI lifespan shutdown."""
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def _fetchone(sql: str, params: tuple = ()) -> Optional[dict]:
    with _get_pool().connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            row = cur.fetchone()
            return dict(row) if row else None


def _fetchall(sql: str, params: tuple = ()) -> list[dict]:
    with _get_pool().connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]


# ─── Schema bootstrap (called once from FastAPI lifespan) ────────
def init_db() -> None:
    """Verify the `tickertrace` schema is reachable. Idempotent.

    The tables already exist in production, created ahead of time via the
    migration DDL (BIGINT GENERATED ALWAYS AS IDENTITY, TIMESTAMPTZ columns,
    indexes) under an admin role. This function does NOT attempt to
    (re-)create them: the app connects as `tickertrace_app`, a role scoped
    to USAGE + SELECT/INSERT/UPDATE/DELETE on this schema's existing objects
    only — deliberately with no CREATE privilege on the database, since this
    Postgres instance also hosts an unrelated product's live billing data in
    `public` and the whole point of a scoped role is that it can't touch (or
    create) anything outside what it's been granted. A `CREATE TABLE IF NOT
    EXISTS` here would just fail with `permission denied for database
    postgres` on every startup (confirmed live) — this checks connectivity
    and that the expected tables are actually visible instead.
    """
    with tx() as conn:
        row = conn.execute(
            "SELECT to_regclass('tickertrace.users') IS NOT NULL AS ok"
        ).fetchone()
        if not row["ok"]:
            raise RuntimeError(
                "tickertrace.users not found — has the schema migration been "
                "applied to this database?"
            )


# ─── Crypto helpers ──────────────────────────────────────────────
def generate_api_key() -> str:
    """Generate a unique API key: tt_live_xxxx."""
    return f"tt_live_{secrets.token_hex(24)}"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


# ─── User CRUD ───────────────────────────────────────────────────
def create_user(
    email: str,
    source: str = "",
    tier: str = "free",
    password: Optional[str] = None,
) -> dict:
    """Create a new user and return their record. Idempotent on email collision."""
    api_key = generate_api_key()
    now = datetime.now(timezone.utc)
    pw_hash = hash_password(password) if password else None

    try:
        with tx() as conn:
            conn.execute(
                "INSERT INTO tickertrace.users (email, api_key, password_hash, tier, source, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                (email, api_key, pw_hash, tier, source, now),
            )
    except psycopg.errors.UniqueViolation as e:
        # Narrowed catch (kept from the SQLite version's review #8):
        # re-raise unless it's the specific email-already-exists collision
        # we expect.
        constraint = (getattr(e.diag, "constraint_name", None) or "").lower()
        msg = str(e).lower()
        if "email" in constraint or "email" in msg:
            existing = get_user_by_email(email)
            if existing:
                return existing
        raise

    return get_user_by_email(email)  # type: ignore[return-value]


def set_password(email: str, password: str) -> bool:
    """Set or update a user's password."""
    pw_hash = hash_password(password)
    with tx() as conn:
        cursor = conn.execute(
            "UPDATE tickertrace.users SET password_hash = %s WHERE email = %s",
            (pw_hash, email),
        )
        return cursor.rowcount > 0


def authenticate(email: str, password: str) -> Optional[dict]:
    """Verify email+password credentials. Returns user dict or None."""
    user = get_user_by_email(email)
    if not user:
        return None
    stored_hash = user.get("password_hash")
    if not stored_hash:
        return None  # user registered without password (legacy)
    if not verify_password(password, stored_hash):
        return None
    return user


def get_user_by_key(api_key: str) -> Optional[dict]:
    return _fetchone("SELECT * FROM tickertrace.users WHERE api_key = %s", (api_key,))


def get_user_by_email(email: str) -> Optional[dict]:
    return _fetchone("SELECT * FROM tickertrace.users WHERE email = %s", (email,))


def get_user_by_stripe_id(stripe_customer_id: str) -> Optional[dict]:
    """Legacy lookup — kept so old DB rows are still queryable."""
    return _fetchone(
        "SELECT * FROM tickertrace.users WHERE stripe_customer_id = %s",
        (stripe_customer_id,),
    )


def upgrade_user(email: str, tier: str = "pro") -> None:
    with tx() as conn:
        conn.execute("UPDATE tickertrace.users SET tier = %s WHERE email = %s", (tier, email))


def downgrade_user(email: str, tier: str = "free") -> None:
    upgrade_user(email, tier)


def log_api_call(api_key: str, endpoint: str) -> None:
    now = datetime.now(timezone.utc)
    with tx() as conn:
        conn.execute(
            "INSERT INTO tickertrace.api_usage (api_key, endpoint, timestamp) VALUES (%s, %s, %s)",
            (api_key, endpoint, now),
        )
        conn.execute(
            "UPDATE tickertrace.users SET last_api_call = %s WHERE api_key = %s",
            (now, api_key),
        )


def get_usage_count(api_key: str, hours: int = 24) -> int:
    """Count API calls in the last N hours."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    row = _fetchone(
        "SELECT COUNT(*) AS cnt FROM tickertrace.api_usage WHERE api_key = %s AND timestamp > %s",
        (api_key, cutoff),
    )
    return row["cnt"] if row else 0


def get_all_users() -> list[dict]:
    return _fetchall("SELECT * FROM tickertrace.users ORDER BY created_at DESC")


# ─── Rate limits per tier (24h windows) ──────────────────────────
RATE_LIMITS = {
    "free": 100,
    "pro": 5000,
    "institutional": 50000,
}

# Tier access: which endpoints are allowed. None = no restriction.
TIER_ACCESS: dict[str, Optional[set[str]]] = {
    "free": {"/api/v1/signals", "/api/v1/stats", "/api/v1/sectors", "/health"},
    "pro": None,
    "institutional": None,
}


def check_access(api_key: str, endpoint: str) -> tuple[bool, str]:
    """
    Check if an API key has access to an endpoint. Returns (allowed, reason).
    Only /auth/me uses this now; the public data endpoints don't require auth.
    """
    user = get_user_by_key(api_key)
    if not user:
        return False, "Invalid API key"

    tier = user["tier"]
    if tier not in TIER_ACCESS:
        return False, f"Unrecognized account tier '{tier}'. Contact support."

    # Auto-downgrade expired promo tiers. promo_expiry comes back from
    # Postgres as a tz-aware datetime (TIMESTAMPTZ), not the ISO text string
    # the old SQLite version compared — compare datetimes directly.
    promo_expiry = user.get("promo_expiry")
    if promo_expiry and promo_expiry < datetime.now(timezone.utc):
        downgrade_user(user["email"])
        tier = "free"

    allowed_endpoints = TIER_ACCESS.get(tier)
    if allowed_endpoints is not None and endpoint not in allowed_endpoints:
        return False, "Forbidden"

    limit = RATE_LIMITS.get(tier, 100)
    usage = get_usage_count(api_key)
    if usage >= limit:
        return False, f"Rate limit exceeded ({usage}/{limit} calls in 24h)."

    return True, "ok"
