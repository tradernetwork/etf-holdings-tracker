"""get_holdings_for_date must not cache equity-only funds (3.3GB resident on prod)."""
import csv

import effectiveness


def _write(path, rows):
    fields = ['ETF Ticker', 'Ticker', 'Option_Type', 'Weight']
    with open(path, 'w', newline='') as f:
        w = csv.DictWriter(f, fields)
        w.writeheader()
        w.writerows(dict(zip(fields, r)) for r in rows)


def test_cache_keeps_funds_with_options_and_drops_equity_only_books(tmp_path, monkeypatch):
    _write(tmp_path / 'holdings_2026-11-20.csv', [
        ('ULTY', 'TSLA', '', 5), ('ULTY', 'TSLA 241220C', 'call', -1),   # has options: keep ALL its rows
        ('ARKK', 'TSLA', '', 9), ('ARKK', 'COIN', '', 4),                 # equity only: drop
    ])
    monkeypatch.setattr(effectiveness, 'HISTORY_DIR', str(tmp_path))
    monkeypatch.setattr(effectiveness, '_holdings_cache', {})
    rows = effectiveness.get_holdings_for_date('2026-11-20')
    assert {r['ETF Ticker'] for r in rows} == {'ULTY'}
    assert len(rows) == 2                       # the fund's equities survive alongside its options
    assert len(effectiveness.get_fund_options(rows, 'ULTY')) == 1
    assert effectiveness.get_fund_equities(rows, 'ULTY')[0]['Ticker'] == 'TSLA'
    assert effectiveness.get_holdings_for_date('2026-11-21') == []     # missing file still empty
