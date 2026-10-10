"""Private anonymous-device API and guarded, durable digest behavior."""
import csv
import hashlib
import json
import sqlite3

import pytest
from fastapi.testclient import TestClient
from api import data

TOKEN = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]'


@pytest.fixture
def notifications(tmp_path, monkeypatch):
    from api import notification_store as store
    monkeypatch.setenv('NOTIFICATIONS_ENABLED', '1')
    monkeypatch.setattr(store, 'DB_PATH', tmp_path / 'notifications.db')
    return store


def client():
    from api.server import app, limiter
    limiter.reset()
    return TestClient(app)


def register(c):
    r = c.post('/notifications/subscribe', json={'transport': 'expo', 'token': TOKEN})
    assert r.status_code == 201, r.text
    body = r.json()
    return body, {'Authorization': f"Bearer {body['secret']}"}


def test_device_lifecycle_and_private_contract(notifications):
    c = client(); device, headers = register(c)
    assert len(device['secret']) >= 40
    with sqlite3.connect(notifications.DB_PATH) as db:
        secret_hash = db.execute('select secret_hash from devices').fetchone()[0]
        assert secret_hash == hashlib.sha256(device['secret'].encode()).hexdigest()
    assert c.get('/notifications/follows').status_code == 401
    assert c.get('/notifications/follows', headers={'Authorization': 'Bearer wrong'}).status_code == 401
    follows = {'follows': [{'kind': 'ticker', 'symbol': 'tsla'}, {'kind': 'fund', 'symbol': 'ARKK'}]}
    assert c.put('/notifications/follows', headers=headers, json=follows).status_code == 200
    assert c.get('/notifications/follows', headers=headers).json()['follows'] == [
        {'kind': 'fund', 'symbol': 'ARKK'}, {'kind': 'ticker', 'symbol': 'TSLA'}]
    replacement=c.post('/notifications/subscribe', json={'transport': 'expo', 'token': TOKEN})
    assert replacement.status_code == 201
    assert replacement.json()['deviceId'] != device['deviceId']
    assert c.get('/notifications/follows',headers=headers).status_code == 401
    headers={'Authorization': f"Bearer {replacement.json()['secret']}"}
    assert c.delete('/notifications/device', headers=headers).status_code == 200
    assert c.get('/notifications/follows', headers=headers).status_code == 401
    with sqlite3.connect(notifications.DB_PATH) as db:
        for table in ['devices', 'follows', 'outbox']:
            assert db.execute(f'select count(*) from {table}').fetchone()[0] == 0


def test_disabled_no_database_or_delivery(tmp_path, monkeypatch):
    from api import notification_store as store, notification_job as job
    monkeypatch.setenv('NOTIFICATIONS_ENABLED', '0')
    monkeypatch.setattr(store, 'DB_PATH', tmp_path / 'disabled.db')
    c = client()
    assert c.post('/notifications/subscribe', json={'transport': 'expo', 'token': TOKEN}).status_code == 503
    assert c.get('/notifications/follows').status_code == 503
    assert job.run_once() == {'enabled': False}
    assert not store.DB_PATH.exists()
    from api.server import app
    assert not any(p.startswith('/notifications') for p in app.openapi()['paths'])


def test_bounded_validation_and_authenticated_rotation(notifications):
    c=client();device,headers=register(c)
    assert c.put('/notifications/follows', headers=headers,json={'follows':[{'kind':'ticker','symbol':'x'}]*101}).status_code==422
    assert c.put('/notifications/follows',headers=headers,json={'follows':[{'kind':'fund','symbol':'ZZZZNOTAFUND'}]}).status_code==422
    assert c.post('/notifications/subscribe',headers=headers,json={'transport':'expo','token':'ExpoPushToken[bbbbbbbbbbbbbbbbbbbbbb]'}).json()==device
    assert c.post('/notifications/subscribe',json={'transport':'web','token':TOKEN}).status_code==422


def snapshot(path, day, rows):
    fields=['ETF Ticker','Ticker','Name','Weight','Share Quantity','Market Value','Sector','Refreshed','Source_Date','Date','Option_Type']
    with (path/f'holdings_{day}.csv').open('w',newline='') as fh:
        w=csv.DictWriter(fh,fieldnames=fields,restval='');w.writeheader();w.writerows(rows)


def book(fund,day,a,b,fresh=True,source=None):
    return [{'ETF Ticker':fund,'Ticker':t,'Name':t,'Weight':w,'Share Quantity':s,
             'Market Value':w*10000,'Sector':'Tech','Refreshed':str(fresh),
             'Source_Date':source or day,'Date':source or day}
            for t,w,s in [('TSLA',a,a*100),('OTHER',b,b*100)]]


@pytest.fixture
def synthetic_history(tmp_path,monkeypatch):
    history=tmp_path/'history';history.mkdir()
    for day,fresh,a,b in [('2026-10-09',False,5,5),('2026-10-12',True,1,9)]:
        rows=book('ARKK',day,a,b,fresh,'2026-09-25' if not fresh else None)
        rows+=book('AVUV',day,5 if not fresh else 6,5 if not fresh else 4)
        # A stale carried-forward book with artificial changes must never alert.
        rows+=book('CGGO',day,5 if not fresh else 8,5 if not fresh else 2,False,'2026-09-25')
        snapshot(history,day,rows)
    monkeypatch.setattr(data,'HISTORY_DIR',str(history));data._available_dates.cache_clear()
    return history


def test_digest_uses_guarded_significant_changes_and_is_idempotent(notifications,synthetic_history,monkeypatch):
    from api import notification_job as job, push_delivery
    device=notifications.create_device(TOKEN)
    notifications.replace_follows(device['deviceId'],[{'kind':'ticker','symbol':'TSLA'},{'kind':'fund','symbol':'ARKK'},{'kind':'fund','symbol':'CGGO'}])
    sent=[]
    monkeypatch.setattr(push_delivery,'send_expo',lambda token,payload:sent.append(payload) or {'status':'ok','id':'ticket-1'})
    first=job.run_once(now=100000);job.run_once(now=100010)
    assert first['prepared']==1
    assert len(sent)==1
    assert sent[0]['data']['snapshotDate']=='2026-10-12'
    assert 'AVUV added to TSLA' in sent[0]['body']
    assert 'ARKK has refreshed' in sent[0]['body']
    assert 'CGGO' not in sent[0]['body']
    with sqlite3.connect(notifications.DB_PATH) as db:
        events=json.loads(db.execute('select events from outbox').fetchone()[0])
        assert len(events)==2
        assert all(e.get('fund')!='CGGO' for e in events)
        assert len([e for e in events if e['fund']=='ARKK'])==1
    c=client();headers={'Authorization':f"Bearer {device['secret']}"}
    assert c.delete('/notifications/unsubscribe',headers=headers).status_code==200
    with sqlite3.connect(notifications.DB_PATH) as db:
        assert db.execute('select count(*) from outbox').fetchone()[0]==0


def test_prunes_invalid_expo_ticket(notifications,synthetic_history,monkeypatch):
    from api import notification_job as job,push_delivery
    d=notifications.create_device(TOKEN);notifications.replace_follows(d['deviceId'],[{'kind':'ticker','symbol':'TSLA'}])
    monkeypatch.setattr(push_delivery,'send_expo',lambda *a:{'status':'error','details':{'error':'DeviceNotRegistered'}})
    job.run_once(now=100000)
    assert notifications.authorize(d['secret']) is None


def test_receipts_prune_only_affected_device(notifications,synthetic_history,monkeypatch):
    from api import notification_job as job,push_delivery
    d=notifications.create_device(TOKEN);notifications.replace_follows(d['deviceId'],[{'kind':'ticker','symbol':'TSLA'}])
    monkeypatch.setattr(push_delivery,'send_expo',lambda *a:{'status':'ok','id':'ticket-2'})
    job.run_once(now=100000)
    monkeypatch.setattr(push_delivery,'get_receipts',lambda ids:{'ticket-2':{'status':'error','details':{'error':'DeviceNotRegistered'}}})
    job.run_once(now=100901)
    assert notifications.authorize(d['secret']) is None


def test_retry_and_empty_digest_are_durable(notifications,synthetic_history,monkeypatch):
    from api import notification_job as job,push_delivery
    d=notifications.create_device(TOKEN);notifications.replace_follows(d['deviceId'],[{'kind':'ticker','symbol':'TSLA'}])
    empty=notifications.create_device('ExpoPushToken[bbbbbbbbbbbbbbbbbbbbbb]')
    calls=[]
    def send(*args):
        calls.append(args)
        if len(calls)==1:raise push_delivery.PushError('unavailable',retryable=True)
        return {'status':'ok','id':'retry-ticket'}
    monkeypatch.setattr(push_delivery,'send_expo',send)
    job.run_once(now=100000);job.run_once(now=100001);job.run_once(now=101000)
    assert len(calls)==2
    with sqlite3.connect(notifications.DB_PATH) as db:
        assert db.execute('select count(*) from outbox').fetchone()[0]==2
        assert db.execute('select status from outbox where device_id=?',(empty['deviceId'],)).fetchone()[0]=='empty'


def test_expo_http_contract(monkeypatch):
    from api import push_delivery as delivery
    calls=[]
    class Response:
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def read(self):return json.dumps({'data':{'status':'ok','id':'t'}}).encode()
    def request(req,**kwargs):calls.append(req);return Response()
    monkeypatch.setattr(delivery,'urlopen',request)
    monkeypatch.setenv('EXPO_ACCESS_TOKEN','private-token')
    assert delivery.send_expo(TOKEN,{'title':'Test','body':'Body','data':{}})['id']=='t'
    req=calls[0];assert req.full_url=='https://exp.host/--/api/v2/push/send'
    assert req.headers['Authorization']=='Bearer private-token'
    assert json.loads(req.data)['to']==TOKEN


def test_test_push_quota_and_digest_ownership(notifications,monkeypatch):
    c=client();d,h=register(c)
    other=notifications.create_device('ExpoPushToken[bbbbbbbbbbbbbbbbbbbbbb]')
    headers={'Authorization':f"Bearer {other['secret']}"}
    for _ in range(3):
        r=c.post('/notifications/test-push',headers=h)
        assert r.status_code==200
    assert c.post('/notifications/test-push',headers=h).status_code==429
    digest=r.json()['digestId']
    assert c.get('/notifications/digests/'+digest,headers=headers).status_code==404
    assert c.get('/notifications/digests/'+digest,headers=h).json()['events']==[]
    assert c.delete('/notifications/device',headers=h).status_code==200
    with sqlite3.connect(notifications.DB_PATH) as db:
        assert db.execute('select count(*) from quotas where device_id=?',(d['deviceId'],)).fetchone()[0]==0


def test_unchanged_follows_and_token_do_not_cancel_digest(notifications,synthetic_history,monkeypatch):
    from api import notification_job as job
    d=notifications.create_device(TOKEN);f=[{'kind':'ticker','symbol':'TSLA'}]
    notifications.replace_follows(d['deviceId'],f)
    assert job.prepare_daily(100000)==1
    notifications.replace_follows(d['deviceId'],f)
    notifications.replace_token(d['deviceId'],TOKEN)
    with sqlite3.connect(notifications.DB_PATH) as db:
        assert db.execute('select status from outbox').fetchone()[0]=='pending'
    notifications.replace_follows(d['deviceId'],[])
    with sqlite3.connect(notifications.DB_PATH) as db:
        assert db.execute('select status from outbox').fetchone()[0]=='cancelled'


def test_rotated_token_is_not_pruned_by_old_receipt(notifications,synthetic_history,monkeypatch):
    from api import notification_job as job,push_delivery
    d=notifications.create_device(TOKEN);notifications.replace_follows(d['deviceId'],[{'kind':'ticker','symbol':'TSLA'}])
    monkeypatch.setattr(push_delivery,'send_expo',lambda *a:{'status':'ok','id':'old-ticket'})
    job.run_once(now=100000)
    notifications.replace_token(d['deviceId'],'ExpoPushToken[bbbbbbbbbbbbbbbbbbbbbb]')
    monkeypatch.setattr(push_delivery,'get_receipts',lambda ids:{'old-ticket':{'status':'error','details':{'error':'DeviceNotRegistered'}}})
    job.run_once(now=100901)
    assert notifications.authorize(d['secret'])==d['deviceId']


def test_missing_fund_and_unparseable_dates_cannot_create_exits(notifications,synthetic_history,monkeypatch):
    from api import notification_job as job
    latest=synthetic_history/'holdings_2026-10-12.csv'
    rows=list(csv.DictReader(latest.open()))
    # Remove one entire book and make the other fund's source dates unknown.
    rows=[r for r in rows if r['ETF Ticker']!='CGGO']
    for r in rows:
        if r['ETF Ticker']=='AVUV':r['Date']=r['Source_Date']='bad date'
    snapshot(synthetic_history,'2026-10-12',rows)
    assert all(e['kind']=='catch-up' for e in job.build_events('2026-10-12'))


def test_significance_uses_active_not_raw_and_fund_threshold(notifications,synthetic_history,monkeypatch):
    from api import notification_job as job
    # The shared diff remains the only producer of active values; inject its output
    # to isolate notification eligibility exactly at its existing boundaries.
    records=[{'fund':'AVUV','ticker':t,'activeWeightDelta':delta,'weightDelta':20,'type':'CHANGED'}
             for t,delta in [('NOISE',0.0099),('EXACT',0.01),('DRIFT',0.0)]]
    monkeypatch.setattr(data,'compute_daily_changes',lambda:records)
    trades=[e for e in job.build_events('2026-10-12') if e['kind']=='trade']
    assert [e['ticker'] for e in trades]==['EXACT']


def test_exhausted_and_expired_outbox_is_not_sent(notifications,synthetic_history,monkeypatch):
    from api import notification_job as job,push_delivery
    d=notifications.create_device(TOKEN);notifications.replace_follows(d['deviceId'],[{'kind':'ticker','symbol':'TSLA'}])
    job.prepare_daily(100000)
    with sqlite3.connect(notifications.DB_PATH) as db:
        db.execute("update outbox set status='sending', attempts=5, lease_until=100001")
    monkeypatch.setattr(push_delivery,'send_expo',lambda *a:pytest.fail('exhausted attempt was sent'))
    assert job.send_pending(100002)==0
    with sqlite3.connect(notifications.DB_PATH) as db:
        assert db.execute('select status from outbox').fetchone()[0]=='failed'


def test_invalid_bearers_consume_ip_quota(notifications):
    c=client()
    for _ in range(60):
        assert c.get('/notifications/follows',headers={'Authorization':'Bearer wrong'}).status_code==401
    assert c.get('/notifications/follows',headers={'Authorization':'Bearer wrong'}).status_code==429


def test_receipt_success_and_missing_expire_without_resend(notifications,synthetic_history,monkeypatch):
    from api import notification_job as job,push_delivery
    d=notifications.create_device(TOKEN);notifications.replace_follows(d['deviceId'],[{'kind':'ticker','symbol':'TSLA'}])
    sent=[]
    monkeypatch.setattr(push_delivery,'send_expo',lambda *a:sent.append(a) or {'status':'ok','id':'receipt'})
    job.run_once(now=100000)
    monkeypatch.setattr(push_delivery,'get_receipts',lambda ids:{'receipt':{'status':'ok'}})
    assert job.poll_receipts(100899)==0
    assert job.poll_receipts(100900)==1
    job.run_once(now=101800)
    assert len(sent)==1
    with sqlite3.connect(notifications.DB_PATH) as db:
        assert db.execute('select status from outbox').fetchone()[0]=='delivered'
        db.execute("update outbox set status='accepted'")
    monkeypatch.setattr(push_delivery,'get_receipts',lambda ids:{})
    job.poll_receipts(186401)
    with sqlite3.connect(notifications.DB_PATH) as db:
        assert db.execute('select status from outbox').fetchone()[0]=='receipt_missing'


def test_claim_recovers_after_crash_and_expiration_blocks_send(notifications,synthetic_history,monkeypatch):
    from api import notification_job as job,push_delivery
    d=notifications.create_device(TOKEN);notifications.replace_follows(d['deviceId'],[{'kind':'ticker','symbol':'TSLA'}])
    job.prepare_daily(100000)
    with sqlite3.connect(notifications.DB_PATH) as db:
        db.execute("update outbox set status='sending',attempts=1,lease_until=100120")
    calls=[]
    monkeypatch.setattr(push_delivery,'send_expo',lambda *a:calls.append(a) or {'status':'ok','id':'recovered'})
    assert job.send_pending(100001)==0
    assert job.send_pending(100121)==1
    assert len(calls)==1
    with sqlite3.connect(notifications.DB_PATH) as db:
        db.execute("update outbox set status='pending'")
    assert job.send_pending(186401)==0
    with sqlite3.connect(notifications.DB_PATH) as db:
        assert db.execute('select status from outbox').fetchone()[0]=='expired'


def test_new_enrollment_after_day_freeze_waits_and_deleted_data_stays_gone(notifications,synthetic_history,monkeypatch):
    from api import notification_job as job
    assert job.prepare_daily(100000)==0
    d=notifications.create_device(TOKEN);notifications.replace_follows(d['deviceId'],[{'kind':'ticker','symbol':'TSLA'}])
    assert job.prepare_daily(100001)==0
    with sqlite3.connect(notifications.DB_PATH) as db:
        assert db.execute('select count(*) from outbox').fetchone()[0]==0
    notifications.delete_device(d['deviceId'])
    assert job.prepare_daily(100002)==0


def test_weekend_snapshot_does_not_change_digest_date(notifications,synthetic_history):
    from api import notification_job as job
    rows=book('AVUV','2026-10-17',8,2)
    snapshot(synthetic_history,'2026-10-17',rows)
    data._available_dates.cache_clear()
    d=notifications.create_device(TOKEN);notifications.replace_follows(d['deviceId'],[{'kind':'ticker','symbol':'TSLA'}])
    assert job.prepare_daily(100000)==1
    with sqlite3.connect(notifications.DB_PATH) as db:
        assert db.execute('select day from outbox').fetchone()[0]=='2026-10-12'


def test_reenrollment_token_quota_survives_replacement(notifications):
    first=notifications.create_device(TOKEN)
    for _ in range(4):notifications.create_device(TOKEN)
    with pytest.raises(notifications.QuotaExceeded):notifications.create_device(TOKEN)
    assert notifications.authorize(first['secret']) is None
    with sqlite3.connect(notifications.DB_PATH) as db:
        assert db.execute('select count(*) from devices').fetchone()[0]==1


def test_invalid_snapshot_date_does_not_freeze_or_send(notifications,synthetic_history,monkeypatch):
    from api import notification_job as job
    monkeypatch.setattr(data,'get_as_of_date',lambda:'unknown')
    assert job.prepare_daily(100000)==0
    with notifications.connect() as db:
        assert db.execute('select count(*) from source_runs').fetchone()[0]==0


def test_input_rewrite_aborts_freeze(notifications,synthetic_history,monkeypatch):
    from api import notification_job as job
    original=data.compute_daily_changes
    def changed():
        result=original()
        p=synthetic_history/'holdings_2026-10-12.csv'
        p.write_text(p.read_text()+'\n')
        return result
    monkeypatch.setattr(data,'compute_daily_changes',changed)
    with pytest.raises(RuntimeError,match='Snapshot changed'):
        job.prepare_daily(100000)
    with sqlite3.connect(notifications.DB_PATH) as db:
        assert db.execute('select count(*) from source_runs').fetchone()[0]==0
        assert db.execute('select count(*) from outbox').fetchone()[0]==0


def test_new_snapshot_during_preparation_aborts_old_day(notifications,synthetic_history,monkeypatch):
    from api import notification_job as job
    original=data.compute_daily_changes
    def newer():
        result=original()
        snapshot(synthetic_history,'2026-10-13',book('AVUV','2026-10-13',8,2))
        return result
    monkeypatch.setattr(data,'compute_daily_changes',newer)
    with pytest.raises(RuntimeError,match='Snapshot changed'):
        job.prepare_daily(100000)


def test_worker_stops_on_its_own_deadline(notifications,synthetic_history,monkeypatch):
    """`timeout` in sync_data.sh only kills the docker client; the in-container worker
    must bound itself. An expired deadline sends nothing and leaves rows pending."""
    import time
    from api import notification_job as job,push_delivery
    d=notifications.create_device(TOKEN);notifications.replace_follows(d['deviceId'],[{'kind':'ticker','symbol':'TSLA'}])
    job.prepare_daily(100000)
    calls=[]
    monkeypatch.setattr(push_delivery,'send_expo',lambda *a:calls.append(a) or {'status':'ok','id':'t1'})
    assert job.send_pending(100001,deadline=time.monotonic()-1)==0 and calls==[]
    with sqlite3.connect(notifications.DB_PATH) as db:
        assert db.execute('select status from outbox').fetchone()[0]=='pending'
    # run_once threads the budget through: a zero budget does no delivery either.
    assert job.run_once(now=100002,budget=0)['accepted']==0 and calls==[]
    # With budget left, the same row is delivered by the next invocation.
    assert job.send_pending(100003,deadline=time.monotonic()+60)==1 and len(calls)==1


def test_subscribe_ip_limit_is_30_per_hour_but_token_quota_stays(notifications):
    c=client()
    for i in range(30):
        tok=f'ExponentPushToken[{i:022d}]'
        assert c.post('/notifications/subscribe',json={'transport':'expo','token':tok}).status_code==201,i
    assert c.post('/notifications/subscribe',json={'transport':'expo','token':'ExponentPushToken[zzzzzzzzzzzzzzzzzzzzzz]'}).status_code==429
    c2=client()   # limiter reset: same token, 5 enrollments/day allowed, 6th refused
    for _ in range(5):
        assert c2.post('/notifications/subscribe',json={'transport':'expo','token':TOKEN}).status_code==201
    assert c2.post('/notifications/subscribe',json={'transport':'expo','token':TOKEN}).status_code==429
