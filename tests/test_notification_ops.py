"""Operator tooling for the go-live test: counts only, no secrets, never sends."""
import pytest

TOKEN = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]'


@pytest.fixture
def ops(tmp_path, monkeypatch):
    from api import notification_store as store, notification_ops as ops
    monkeypatch.setenv('NOTIFICATIONS_ENABLED', '1')
    monkeypatch.setattr(store, 'DB_PATH', tmp_path / 'notifications.db')
    return store, ops


def test_status_shows_counts_and_never_the_token_secret_or_follows(ops, capsys):
    store, o = ops
    d = store.create_device(TOKEN)
    store.replace_follows(d['deviceId'], [{'kind': 'ticker', 'symbol': 'TSLA'}, {'kind': 'fund', 'symbol': 'ARKK'}])
    out = o.status()
    assert 'devices: 1' in out and 'follows 2' in out and d['deviceId'][:8] in out
    for secret in (TOKEN, d['secret'], 'TSLA', 'ARKK', 'aaaaaaaaaaaaaaaaaaaaaa'):
        assert secret not in out
    assert 'token …aaaa' in out


def test_queue_test_needs_exactly_one_device_and_sends_nothing(ops, monkeypatch):
    store, o = ops
    from api import push_delivery
    monkeypatch.setattr(push_delivery, 'send_expo', lambda *a: pytest.fail('ops must never send'))
    with pytest.raises(SystemExit):
        o.queue_test()                               # no device
    d1 = store.create_device(TOKEN)
    did, digest = o.queue_test()
    assert did == d1['deviceId']
    out = o.status()
    assert 'pending' in out and 'test:' in out
    store.create_device('ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]')
    with pytest.raises(SystemExit):
        o.queue_test()                               # two devices: ambiguous
    assert o.queue_test(d1['deviceId'][:8])[0] == d1['deviceId']


def test_purge_removes_everything_and_requires_yes(ops):
    store, o = ops
    store.create_device(TOKEN)
    with pytest.raises(SystemExit):
        o.main(['purge'])
    assert o.main(['purge', '--yes']) == 0
    assert 'devices: 0' in o.status()
