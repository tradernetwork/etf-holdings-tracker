"""Device management; deliberately excluded from the data-only OpenAPI spec."""
import re
import sqlite3
from typing import Literal

from fastapi.responses import JSONResponse
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from . import data, notification_store as store


class Subscription(BaseModel):
    transport: Literal['expo']
    token: str = Field(min_length=20, max_length=256, pattern=r'^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$')


class Follow(BaseModel):
    kind: Literal['fund', 'ticker']
    symbol: str = Field(min_length=1, max_length=16)

    @field_validator('symbol')
    @classmethod
    def normalize(cls, value):
        value = value.strip().upper()
        if not re.fullmatch(r'[A-Z0-9][A-Z0-9.\-]{0,15}', value):
            raise ValueError('Invalid symbol')
        return value


class Follows(BaseModel):
    follows: list[Follow] = Field(max_length=100)


def require_enabled():
    if not store.enabled():
        raise HTTPException(503, 'Notifications are coming soon')


def bearer(authorization):
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(401, 'Device bearer secret required')
    secret = authorization[7:]
    if len(secret) > 256:
        raise HTTPException(401, 'Invalid device secret')
    device_id = store.authorize(secret)
    if not device_id:
        raise HTTPException(401, 'Invalid device secret')
    return device_id, secret


def limit_device(device_id, action, count, seconds):
    if not store.quota(device_id, action, count, seconds):
        raise HTTPException(429, 'Device notification quota exceeded')


def build_router(limiter):
    router = APIRouter(prefix='/notifications', include_in_schema=False,
                       dependencies=[Depends(require_enabled)])

    @router.post('/subscribe', status_code=201)
    # Per IP: generous because carrier-grade NAT and shared wifi put many real users behind one
    # address. The abuse brake that matters is the 5/day-per-token enrollment quota in the store.
    @limiter.limit('30/hour')
    def subscribe(request: Request, body: Subscription, authorization: str | None = Header(None)):
        try:
            if authorization:
                device_id, secret = bearer(authorization)
                limit_device(device_id, 'subscribe', 10, 3600)
                store.replace_token(device_id, body.token)
                return JSONResponse({'deviceId': device_id, 'secret': secret}, status_code=200)
            return store.create_device(body.token)
        except store.QuotaExceeded:
            raise HTTPException(429, 'Token enrollment quota exceeded') from None
        except sqlite3.IntegrityError:
            raise HTTPException(409, 'Subscription already registered; use its management secret') from None

    @router.get('/follows')
    @limiter.limit('60/minute')
    def follows(request: Request, authorization: str | None = Header(None)):
        device_id = bearer(authorization)[0]
        return {'follows': store.list_follows(device_id)}

    @router.put('/follows')
    @limiter.limit('20/hour')
    def update_follows(request: Request, body: Follows, authorization: str | None = Header(None)):
        device_id = bearer(authorization)[0]
        if any(f.kind == 'fund' and f.symbol not in data.FUND_PROVIDERS for f in body.follows):
            raise HTTPException(422, 'Unknown followed fund')
        limit_device(device_id, 'follows', 20, 3600)
        store.replace_follows(device_id, [f.model_dump() for f in body.follows])
        return {'follows': store.list_follows(device_id)}

    @router.delete('/unsubscribe')
    @router.delete('/device')
    @limiter.limit('30/hour')
    def delete(request: Request, authorization: str | None = Header(None)):
        device_id = bearer(authorization)[0]
        store.delete_device(device_id)
        return {'deleted': True}

    @router.post('/test-push')
    @limiter.limit('10/hour')
    def test_push(request: Request, authorization: str | None = Header(None)):
        device_id = bearer(authorization)[0]
        from .notification_job import queue_test
        limit_device(device_id, 'test', 3, 86400)
        # Worker handles provider calls and receipts, so even this endpoint never waits on Expo.
        return {'queued': True, 'digestId': queue_test(device_id)}

    @router.get('/digests/{digest_id}')
    @limiter.limit('60/minute')
    def digest(request: Request, digest_id: str, authorization: str | None = Header(None)):
        device_id = bearer(authorization)[0]
        import json
        with store.connect() as db:
            row = db.execute('SELECT day,events,status FROM outbox WHERE id=? AND device_id=?', (digest_id,device_id)).fetchone()
        if not row:
            raise HTTPException(404, 'Digest not found')
        return {'snapshotDate': row['day'], 'events': json.loads(row['events']), 'status': row['status']}

    return router
