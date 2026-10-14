import sqlite3
from api import usage, notification_store
from fastapi.testclient import TestClient
from api.server import app


def test_counters_aggregate_without_identifiers(tmp_path):
    c = usage.Counter(tmp_path / 'usage.db')
    c.add('fund','ARKK','app'); c.add('fund','ARKK','app'); c.add('ticker','TSLA','mcp')
    c.flush()
    with sqlite3.connect(c.path) as db:
        cols = [r[1] for r in db.execute('PRAGMA table_info(views)')]
        assert cols == ['day','kind','symbol','source','count']
        assert db.execute('SELECT count FROM views WHERE symbol="ARKK"').fetchone()[0] == 2
    assert usage.report(c.path, 7)['views'][0]['sources'] == {'app': 2}


def test_sources_and_bot_skip():
    assert usage.request_key('/api/v1/fund/ARKK', 'app','Mozilla/5.0') == ('fund','ARKK','app')
    assert usage.request_key('/api/v1/stock/tsla','','Mozilla/5.0') == ('ticker','TSLA','api')
    assert usage.request_key('/api/v1/options/AMD','app','Googlebot') is None
    assert usage.request_key('/api/v1/ticker/TSLA','web','Mozilla') is None
    assert usage.request_key('/api/v1/fund/ARKK/history','','Mozilla') is None


def test_follower_totals_only_and_zero_after_deletion(tmp_path, monkeypatch):
    monkeypatch.setattr(notification_store, 'DB_PATH', tmp_path / 'notifications.db')
    a=notification_store.create_device('ExponentPushToken[first]')
    b=notification_store.create_device('ExponentPushToken[second]')
    notification_store.replace_follows(a['deviceId'],[{'kind':'fund','symbol':'ARKK'}])
    notification_store.replace_follows(b['deviceId'],[{'kind':'fund','symbol':'ARKK'},{'kind':'ticker','symbol':'TSLA'}])
    c=usage.Counter(tmp_path/'usage.db'); c.snapshot_followers()
    r=usage.report(c.path,7)
    assert r['followers'][0] == {'kind':'fund','symbol':'ARKK','followers':2}
    assert a['deviceId'] not in str(r) and b['secret'] not in str(r)
    with notification_store.connect() as db: db.execute('DELETE FROM follows')
    c.snapshot_followers()
    assert usage.report(c.path,7)['followers'] == []


def test_admin_hidden_and_authenticated(tmp_path, monkeypatch):
    monkeypatch.setattr(usage, 'DB_PATH', tmp_path/'usage.db')
    client=TestClient(app)
    monkeypatch.delenv('ADMIN_TOKEN',raising=False)
    assert client.get('/api/v1/admin/usage').status_code == 404
    monkeypatch.setenv('ADMIN_TOKEN','private-admin-token')
    assert client.get('/api/v1/admin/usage').status_code == 404
    assert client.get('/api/v1/admin/usage',headers={'Authorization':'Bearer wrong'}).status_code == 404
    assert client.get('/api/v1/admin/usage',headers={'Authorization':'Bearer private-admin-token'}).status_code == 200
    assert '/api/v1/admin/usage' not in app.openapi()['paths']


def test_mcp_success_is_tagged_and_failures_not_counted(monkeypatch):
    calls=[]
    monkeypatch.setattr(usage.counter,'add',lambda *a: calls.append(a))
    @usage.counted('fund','fund')
    def tool(fund): return {'fund':fund} if fund!='NOPE' else {'error':'missing'}
    tool('ARKK'); tool('NOPE')
    assert calls == [('fund','ARKK','mcp')]


def test_storage_failure_cannot_fail_request(tmp_path, monkeypatch):
    monkeypatch.setattr(usage.counter,'add',lambda *a: (_ for _ in ()).throw(OSError('disk full')))
    from api import data
    monkeypatch.setattr(data,'get_fund_detail',lambda _: {'fund':'ARKK'})
    assert TestClient(app).get('/api/v1/fund/ARKK').status_code == 200


def test_wal_shared_workers_do_not_lose_counts(tmp_path):
    import concurrent.futures
    path=tmp_path/'usage.db'
    # Initialize before the concurrent writer test; startup contention is retried.
    seed=usage.Counter(path); seed.add('fund','ARKK','api'); seed.flush()
    counters=[usage.Counter(path), usage.Counter(path)]
    for c in counters:
        for _ in range(100):c.add('fund','ARKK','api')
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        list(pool.map(lambda c:c.flush(),counters))
    for c in counters:c.flush()  # any SQLITE_BUSY batch was buffered, not lost
    assert usage.report(path,7)['views'][0]['views']==201


def test_http_counting_success_source_web_and_bot_rules(tmp_path, monkeypatch):
    c=usage.Counter(tmp_path/'usage.db')
    monkeypatch.setattr(usage,'counter',c)
    from api import data
    monkeypatch.setattr(data,'get_fund_detail',lambda f: {'fund':f} if f=='ARKK' else None)
    client=TestClient(app)
    client.get('/api/v1/fund/ARKK',headers={'X-TickerTrace-Client':'app'})
    client.get('/api/v1/fund/ARKK')
    client.get('/api/v1/fund/ARKK',headers={'X-TickerTrace-Client':'web'})
    client.get('/api/v1/fund/ARKK',headers={'User-Agent':'Googlebot'})
    client.get('/api/v1/fund/UNKNOWN')
    c.flush()
    assert usage.report(c.path,7)['views'][0]['sources'] == {'api':1,'app':1}


def test_mcp_bot_not_counted(monkeypatch):
    from fastmcp.server import dependencies
    calls=[]
    monkeypatch.setattr(dependencies,'get_http_headers',lambda: {'user-agent':'CrawlerBot'})
    monkeypatch.setattr(usage.counter,'add',lambda *a:calls.append(a))
    @usage.counted('ticker','ticker')
    def tool(ticker):return {'ticker':ticker}
    tool('TSLA')
    assert calls==[]
