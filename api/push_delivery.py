"""Expo-only transport. URLs are fixed; no client-supplied destination URLs."""
import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE = 'https://exp.host/--/api/v2/push/'


class PushError(Exception):
    def __init__(self, code, retryable=False):
        super().__init__(code)
        self.retryable = retryable


def _post(path, body):
    headers = {'Content-Type': 'application/json', 'Accept': 'application/json'}
    token = os.getenv('EXPO_ACCESS_TOKEN')
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = Request(BASE + path, data=json.dumps(body).encode(), headers=headers, method='POST')
    try:
        with urlopen(req, timeout=15) as response:
            result = json.loads(response.read())
    except HTTPError as e:
        raise PushError(f'http_{e.code}', retryable=e.code == 429 or e.code >= 500) from None
    except (URLError, TimeoutError, OSError):
        raise PushError('network_error', retryable=True) from None
    except (ValueError, TypeError):
        raise PushError('invalid_response', retryable=True) from None
    if not isinstance(result, dict) or result.get('errors') or 'data' not in result:
        raise PushError('provider_error')
    return result['data']


def send_expo(token, payload):
    ticket = _post('send', {**payload, 'to': token, 'sound': 'default', 'channelId': 'digest', 'ttl': 86400})
    if not isinstance(ticket, dict) or ticket.get('status') not in ('ok', 'error'):
        raise PushError('invalid_ticket', retryable=True)
    return ticket


def get_receipts(ids):
    receipts = _post('getReceipts', {'ids': ids})
    if not isinstance(receipts, dict):
        raise PushError('invalid_receipts', retryable=True)
    return receipts
