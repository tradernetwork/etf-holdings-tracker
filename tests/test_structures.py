"""
Option-structure pairing (api/structures.py).

Pure-function tests pin the pairing rules; one end-to-end test runs
get_option_structures over two synthetic snapshot files.
"""
import csv

from api import data as d
from api import structures as st


def _leg(t, strike, expiry, contracts, **kw):
    return {'optionType': t, 'strike': strike, 'expiry': expiry, 'contracts': contracts,
            'isFlex': None, 'dte': None, 'marketValue': None, 'occ': '', **kw}


# ─── Held structures ────────────────────────────────────────────────────────

def test_amdy_book_decomposes():
    """+7,420 490C / −7,420 490.01P is a synthetic long; −900 650C / +900 700C
    is a credit call spread; an unmatched short call stands alone."""
    legs = [
        _leg('CALL', 490.0, '2026-10-16', 7420),
        _leg('PUT', 490.01, '2026-10-16', -7420),
        _leg('CALL', 650.0, '2026-10-02', -900),
        _leg('CALL', 700.0, '2026-10-02', 900),
        _leg('CALL', 640.0, '2026-10-02', -50),
    ]
    got = {(s['kind'], s.get('side'), s['contracts']) for s in st._pair_structures(legs)}
    assert got == {('synthetic-long', None, 7420), ('call-spread', 'credit', 900),
                   ('single', 'written', 50)}


def test_spread_side_and_synthetic_short():
    legs = [
        _leg('PUT', 90.0, '2026-10-16', -10), _leg('PUT', 80.0, '2026-10-16', 10),   # bull put: credit
        _leg('CALL', 100.0, '2026-10-16', 5), _leg('CALL', 110.0, '2026-10-16', -5),  # bull call: debit
        _leg('CALL', 50.0, '2026-12-18', -3), _leg('PUT', 50.0, '2026-12-18', 3),     # synthetic short
    ]
    got = {(s['kind'], s.get('side')) for s in st._pair_structures(legs)}
    assert got == {('put-spread', 'credit'), ('call-spread', 'debit'), ('synthetic-short', None)}


def test_collar():
    legs = [_leg('CALL', 110.0, '2026-10-16', -20), _leg('PUT', 90.0, '2026-10-16', 20)]
    assert [s['kind'] for s in st._pair_structures(legs)] == ['collar']


def test_unequal_sizes_do_not_pair():
    legs = [_leg('CALL', 100.0, '2026-10-16', 10), _leg('PUT', 100.0, '2026-10-16', -9)]
    assert [s['kind'] for s in st._pair_structures(legs)] == ['single', 'single']


# ─── Trades ─────────────────────────────────────────────────────────────────

def _chg(t, strike, expiry, prev, cur):
    return _leg(t, strike, expiry, cur, prevContracts=prev, change=cur - prev)


def test_roll_pairs_close_and_open_on_same_side():
    trades = st._pair_trades([
        _chg('CALL', 650.0, '2026-09-25', -900, 0),     # written call closed/expired
        _chg('CALL', 660.0, '2026-10-02', 0, -900),     # rewritten a week out
    ])
    assert [t['kind'] for t in trades] == ['roll']


def test_synthetic_opened():
    trades = st._pair_trades([
        _chg('CALL', 490.0, '2026-10-16', 0, 7420),
        _chg('PUT', 490.01, '2026-10-16', 0, -7420),
    ])
    assert [t['kind'] for t in trades] == ['synthetic']


def test_spread_and_single_in_same_bucket_prefers_structure():
    trades = st._pair_trades([
        _chg('CALL', 650.0, '2026-10-02', 0, -100),
        _chg('CALL', 700.0, '2026-10-02', 0, 100),
        _chg('PUT', 500.0, '2026-11-20', 0, 100),        # same size, no partner left
        _chg('CALL', 640.0, '2026-10-02', 0, -37),        # odd size
    ])
    kinds = sorted(t['kind'] for t in trades)
    assert kinds == ['single', 'single', 'spread']


def test_roll_beats_spread_when_both_possible():
    trades = st._pair_trades([
        _chg('CALL', 650.0, '2026-09-25', -5, 0),
        _chg('CALL', 650.0, '2026-10-02', 0, -5),
        _chg('CALL', 700.0, '2026-09-25', 0, 5),
    ])
    assert trades[0]['kind'] == 'roll'


# ─── End to end ─────────────────────────────────────────────────────────────

FIELDS = ['ETF Ticker', 'Ticker', 'Name', 'Date', 'Weight', 'Share Quantity', 'Market Value',
          'Option_Type', 'Option_Strike', 'Option_Expiry', 'Underlying_Ticker', 'DTE']


def _write(path, rows):
    with open(path, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, '') for k in FIELDS})


def _o(fund, occ, t, k, exp, q, date):
    return {'ETF Ticker': fund, 'Ticker': occ, 'Name': occ, 'Date': date, 'Weight': '0.1',
            'Share Quantity': str(q), 'Market Value': '1', 'Option_Type': t,
            'Option_Strike': str(k), 'Option_Expiry': exp, 'Underlying_Ticker': 'AMD'}


def test_get_option_structures_end_to_end(tmp_path, monkeypatch):
    _write(tmp_path / 'holdings_2026-09-24.csv', [
        _o('AMDY', '2AMD C490', 'Call', 490.0, '2026-10-16', 7420, '2026-09-24'),
        _o('AMDY', '2AMD P490.01', 'Put', 490.01, '2026-10-16', -7420, '2026-09-24'),
        _o('AMDY', 'AMD C650 0925', 'Call', 650.0, '2026-09-25', -900, '2026-09-24'),
        _o('EGGQ', 'AMD C520', 'Call', 520.0, '2026-09-04', -5, '2026-08-14'),
    ])
    _write(tmp_path / 'holdings_2026-09-25.csv', [
        _o('AMDY', '2AMD C490', 'Call', 490.0, '2026-10-16', 7420, '2026-09-25'),
        _o('AMDY', '2AMD P490.01', 'Put', 490.01, '2026-10-16', -7420, '2026-09-25'),
        _o('AMDY', 'AMD C660 1002', 'Call', 660.0, '2026-10-02', -900, '2026-09-25'),
        # Frozen issuer: same expired leg again.
        _o('EGGQ', 'AMD C520', 'Call', 520.0, '2026-09-04', -5, '2026-08-14'),
    ])
    monkeypatch.setattr(d, 'HISTORY_DIR', str(tmp_path))
    monkeypatch.setattr(st, 'HISTORY_DIR', str(tmp_path))
    d.get_available_dates.cache_clear() if hasattr(d.get_available_dates, 'cache_clear') else None

    r = st.get_option_structures('amd')
    assert r['underlying'] == 'AMD' and r['asOfDate'] == '2026-09-25'
    funds = {f['fund']: f for f in r['funds']}
    # EGGQ holds only a dead contract and did nothing — omitted entirely.
    assert set(funds) == {'AMDY'}
    amdy = funds['AMDY']
    assert amdy['compareDate'] == '2026-09-24'
    assert {s['kind'] for s in amdy['structures']} == {'synthetic-long', 'single'}
    assert [t['kind'] for t in amdy['trades']] == ['roll']
    assert amdy['pairedPct'] == 100.0
    put = next(l for l in amdy['legs'] if l['optionType'] == 'PUT')
    assert put['contracts'] == -7420 and put['change'] == 0 and put['isFlex'] is True


def test_unknown_underlying_is_none(monkeypatch, tmp_path):
    _write(tmp_path / 'holdings_2026-09-25.csv', [])
    monkeypatch.setattr(d, 'HISTORY_DIR', str(tmp_path))
    monkeypatch.setattr(st, 'HISTORY_DIR', str(tmp_path))
    assert st.get_option_structures('ZZZZ') is None


# ─── Fund activity timeline ─────────────────────────────────────────────────

FIELDS_Q = FIELDS + ['Refreshed']


def _write_q(path, rows):
    with open(path, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=FIELDS_Q)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, '') for k in FIELDS_Q})


def test_fund_activity_is_dated_contract_based_and_paired(tmp_path, monkeypatch):
    st._snapshot_cached.cache_clear()
    # Mon 9/21: short 650C 9/25 + synthetic. Tue 9/22: nothing changes except
    # WEIGHT (must not register). Wed 9/23: carried forward. Thu 9/24: the 650C
    # expires/rolls into a 660C 10/02 and a new 100-lot put is written.
    base = [_o('AMDY', 'S1', 'Call', 490.0, '2026-10-16', 7420, 'x'),
            _o('AMDY', 'S2', 'Put', 490.01, '2026-10-16', -7420, 'x')]
    _write_q(tmp_path / 'holdings_2026-09-21.csv',
             base + [_o('AMDY', 'C1', 'Call', 650.0, '2026-09-25', -900, 'x')])
    tue = base + [_o('AMDY', 'C1', 'Call', 650.0, '2026-09-25', -900, 'x')]
    tue[0] = {**tue[0], 'Weight': '9.9'}
    _write_q(tmp_path / 'holdings_2026-09-22.csv', tue)
    _write_q(tmp_path / 'holdings_2026-09-23.csv',
             [{**r, 'Refreshed': 'False'} for r in tue])
    _write_q(tmp_path / 'holdings_2026-09-24.csv',
             base + [_o('AMDY', 'C2', 'Call', 660.0, '2026-10-02', -900, 'x'),
                     _o('AMDY', 'P1', 'Put', 500.0, '2026-10-16', -100, 'x')])
    monkeypatch.setattr(d, 'HISTORY_DIR', str(tmp_path))
    monkeypatch.setattr(st, 'HISTORY_DIR', str(tmp_path))

    days = st.get_fund_option_activity('amdy', days=10)['days']
    assert [x['date'] for x in days] == ['2026-09-24', '2026-09-23', '2026-09-22']
    thu, wed, tue_ = days
    assert thu['compareDate'] == '2026-09-23'
    kinds = sorted((t['kind'], t.get('action')) for t in thu['trades'])
    assert kinds == [('roll', None), ('single', 'open')]
    assert wed['refreshed'] is False and wed['trades'] == []
    assert tue_['trades'] == []  # weight moved, contracts didn't
    st._snapshot_cached.cache_clear()


def test_single_kinds():
    leg = lambda c, p, exp='2026-10-02': {'contracts': c, 'prevContracts': p, 'expiry': exp}
    assert st._single_kind(leg(-100, 0), '2026-09-24') == 'open'
    assert st._single_kind(leg(0, -100, '2026-09-18'), '2026-09-24') == 'expired'
    assert st._single_kind(leg(0, -100), '2026-09-24') == 'close'
    assert st._single_kind(leg(-150, -100), '2026-09-24') == 'add'
    assert st._single_kind(leg(-50, -100), '2026-09-24') == 'reduce'
    assert st._single_kind(leg(50, -100), '2026-09-24') == 'flip'
