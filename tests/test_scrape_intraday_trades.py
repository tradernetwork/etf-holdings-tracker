"""Fetcher: both response shapes, fail-soft behaviour, idempotent ingest."""

import importlib.util
import os

SPEC = importlib.util.spec_from_file_location(
    'scrape_intraday_trades',
    os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'scrape_intraday_trades.py'))
S = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(S)

CSV = ('Date,Fund,Ticker,Type,Qty/Par Value,Exec Price\n'
       '08/29/2025,ULTY,AFRM  250829C00083000,SS,"1,200",1.25\n'
       '08/29/2025,ULTY,AFRM,B,100,50.10\n'
       '08/29/2025,ULTY,AFRM,ZZ,100,50.10\n')


class Resp:
    def __init__(self, text, ctype):
        self.text, self.headers = text, {'content-type': ctype}
    def raise_for_status(self):
        pass


def test_direct_csv():
    assert S.fetch_csv_text(lambda u: Resp(CSV, 'text/csv; charset=utf-8')) == CSV


def test_html_page_with_iframe_followed_and_relative_src_resolved():
    seen = []
    def get(u):
        seen.append(u)
        return Resp('<html><iframe src="/files/t.csv"></iframe></html>', 'text/html') if len(seen) == 1 else Resp(CSV, 'text/csv')
    assert S.fetch_csv_text(get, url='https://example.test/page') == CSV
    assert seen[1] == 'https://example.test/files/t.csv'


def test_html_without_iframe_and_unknown_type_raise():
    import pytest
    with pytest.raises(RuntimeError):
        S.fetch_csv_text(lambda u: Resp('<html></html>', 'text/html'))
    with pytest.raises(RuntimeError):
        S.fetch_csv_text(lambda u: Resp('x', 'application/pdf'))


def test_ingest_counts_rejects_and_is_idempotent(tmp_path):
    s1 = S.ingest('﻿' + CSV, str(tmp_path))
    assert (s1['rows'], s1['parsed'], s1['rejected']) == (3, 2, {'unknown_side:ZZ': 1})
    assert s1['added'] == {'2025-08-29': 2}
    assert S.ingest(CSV, str(tmp_path))['added'] == {}


def test_main_fails_soft(monkeypatch, capsys):
    monkeypatch.setattr(S, 'fetch_csv_text', lambda *a, **k: (_ for _ in ()).throw(ConnectionError('403')))
    assert S.main([]) == 0
    assert 'skipped: ConnectionError' in capsys.readouterr().out
