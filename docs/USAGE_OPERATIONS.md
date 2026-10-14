# Anonymous popularity totals

`api/data/usage.db` is in Compose's existing persistent read-write mount.
Its WAL tables contain ONLY UTC day, fund/ticker, symbol, client source and total
(or follower total). No IP, UA, request ID, device/install ID, push token,
access secret or per-request event is persisted. `follower_days` records only
which daily snapshots completed, including days with zero followers.

Successful GET fund/ticker/stock/options detail requests are recorded through
an existing middleware, with no extra middleware hop. Matching four MCP detail
tools count once as `mcp`. The app sends a constant `X-TickerTrace-Client: app`;
tagged website reads are skipped. Obvious bot UAs are checked then discarded.
The static header is self-reported, not trusted attribution or an identifier.
Caches mean these counts are NOT unique users or actual screen-open counts.

Each process adds to a bounded in-memory map of AGGREGATE keys using a nonblocking
lock. No disk/network work or thread scheduling happens in request handling.
A daemon flushes every two seconds into atomic SQLite upserts, safe with two
workers. Failure retries the bounded aggregate batch; contention/overload or
an abrupt crash may undercount, never fail the data request. Graceful shutdown
flushes. Measured Counter.add ~1.86 microseconds/call locally (min of five runs).

Every five minutes the worker opens the notification DB read-only and SELECTs
`kind,symbol,COUNT(*) GROUP BY kind,symbol`. The follows table's composite primary
key ensures one device per symbol. No device rows or joins leave that DB. Only
registered notification follows are available; local-only stars remain local.
Each day's latest snapshot replaces that day's totals, including deletion to zero.
Reports rank followers by the latest snapshot, NOT a sum across days. Anonymous
rollups older than the 90-day window are pruned on background writes.

## Private reporting

`GET /api/v1/admin/usage?days=7` requires `Authorization: Bearer <ADMIN_TOKEN>`.
Without an environment token or with incorrect/missing authorization it returns
404, including invalid query parameters. It is excluded from OpenAPI/MCP/public
schemas. Do not put the token in a URL or app code. Authorized days are 1–90.

Local operator CLI (container/filesystem access required):
`docker compose exec -T api python -m api.usage_report --days 7`.
JSON includes ranked views with per-source totals, latest aggregate follower
counts and daily follower totals. None contains a registration or identifier.

Deploy after CI passes. Preserve all existing `api/.env` entries, particularly
`NOTIFICATIONS_ENABLED=1`; use an atomic read-modify-write to add ADMIN_TOKEN.
Store the secret locally at `~/secrets/tickertrace-play/admin-token`, mode 600,
outside the repository. Recreate, rather than merely restart, the service so
Compose rereads env_file. Verify unauthorized 404, authorized totals after two
fund requests and notification enabled status. Do not print the token.

The privacy wording and required Play Console edits are in
[PLAY_STORE_LISTING.md](PLAY_STORE_LISTING.md); no third-party SDK is added.
