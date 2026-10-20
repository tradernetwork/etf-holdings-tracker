"""
Tests for activeWeightDelta — the drift-adjusted measure of what a fund
manager actually DID, as opposed to what the market did to them.

The two failure modes these lock down were both measured on real production
data (2026-07-08 -> 2026-07-09):

  * Raw weight is price-contaminated. Its sign agreed with the fund's actual
    share change only ~49% of the time, and ~55% of all "signals" came from
    rows where zero shares changed hands.
  * Raw shares are flow-contaminated. EGGY issued +2.63% creation units and
    every one of its 19 equity positions gained exactly +2.63% shares without
    the manager expressing any view at all.

activeWeightDelta must be blind to both.
"""


def _rows(fund, holdings):
    """holdings: list of (ticker, shares, price, weight)."""
    return [
        {
            'ETF Ticker': fund,
            'Ticker': t,
            'Name': t,
            'Sector': 'TECH',
            'Share Quantity': str(sh),
            'Market Value': str(sh * px),
            'Weight': str(w),
            'Option_Type': '',
        }
        for t, sh, px, w in holdings
    ]


def test_pure_price_move_is_not_a_trade():
    """Nobody trades; AAA doubles. Raw weight screams buy, active says nothing."""
    from api import data as _data

    prev = _rows('FUND', [('AAA', 100, 10.0, 50.0), ('BBB', 100, 10.0, 50.0)])
    # AAA doubles to $20. Shares untouched. New weights: 2000/3000, 1000/3000.
    curr = _rows('FUND', [('AAA', 100, 20.0, 66.667), ('BBB', 100, 10.0, 33.333)])

    changes = {c['ticker']: c for c in _data._changes_between(curr, prev)}

    assert changes['AAA']['sharesDelta'] == 0
    assert changes['AAA']['weightDelta'] > 16, "raw weight should show the price move"
    assert abs(changes['AAA']['activeWeightDelta']) < 0.01, \
        f"price-only move leaked into active: {changes['AAA']['activeWeightDelta']}"
    assert abs(changes['BBB']['activeWeightDelta']) < 0.01


def test_pro_rata_inflow_is_not_conviction():
    """The EGGY case: +10% creation units, every position scaled, zero intent."""
    from api import data as _data

    prev = _rows('FUND', [('AAA', 100, 10.0, 50.0), ('BBB', 200, 5.0, 50.0)])
    # Prices flat; fund issues creation units and deploys pro-rata (+10% shares).
    curr = _rows('FUND', [('AAA', 110, 10.0, 50.0), ('BBB', 220, 5.0, 50.0)])

    changes = {c['ticker']: c for c in _data._changes_between(curr, prev)}

    # Shares moved on both — a naive shares-based metric would call these buys.
    assert changes['AAA']['sharesDelta'] == 10
    assert changes['BBB']['sharesDelta'] == 20
    for t in ('AAA', 'BBB'):
        assert abs(changes[t]['activeWeightDelta']) < 0.01, \
            f"{t}: pro-rata inflow read as conviction ({changes[t]['activeWeightDelta']})"


def test_real_rotation_is_detected_through_a_price_move():
    """Manager sells AAA into BBB while AAA is rallying.

    Raw weight can still show AAA *up* (the rally outruns the sale). Active
    weight must show the sale.
    """
    from api import data as _data

    prev = _rows('FUND', [('AAA', 100, 10.0, 50.0), ('BBB', 100, 10.0, 50.0)])
    # AAA doubles to $20 but manager sells 40 shares: 60*20 = 1200.
    # BBB flat at $10, manager buys 80 shares: 180*10 = 1800. Total 3000.
    curr = _rows('FUND', [('AAA', 60, 20.0, 40.0), ('BBB', 180, 10.0, 60.0)])

    changes = {c['ticker']: c for c in _data._changes_between(curr, prev)}

    assert changes['AAA']['sharesDelta'] == -40
    assert changes['AAA']['activeWeightDelta'] < 0, "sale hidden by the rally"
    assert changes['BBB']['sharesDelta'] == 80
    assert changes['BBB']['activeWeightDelta'] > 0
    # Zero-sum: the manager moved money from one sleeve to another.
    total = sum(c['activeWeightDelta'] for c in changes.values())
    assert abs(total) < 0.05, f"active deltas should net to ~0, got {total}"


def test_sign_agrees_with_shares_when_prices_move():
    """The AMD case: ARKK sold, raw weight said 'top buyer'."""
    from api import data as _data

    prev = _rows('FUND', [('AMD', 1000, 100.0, 50.0), ('OTH', 1000, 100.0, 50.0)])
    # AMD rips +30%, manager trims 100 shares. OTH flat.
    # AMD: 900*130 = 117000. OTH: 100000. total 217000 -> 53.92% / 46.08%
    curr = _rows('FUND', [('AMD', 900, 130.0, 53.917), ('OTH', 1000, 100.0, 46.083)])

    changes = {c['ticker']: c for c in _data._changes_between(curr, prev)}
    amd = changes['AMD']

    assert amd['sharesDelta'] < 0, "the manager sold"
    assert amd['weightDelta'] > 0, "raw weight misreports this as buying"
    assert amd['activeWeightDelta'] < 0, "active weight must agree with the sale"


def test_new_position_is_entirely_active():
    from api import data as _data

    prev = _rows('FUND', [('AAA', 100, 10.0, 100.0)])
    curr = _rows('FUND', [('AAA', 100, 10.0, 80.0), ('NEW', 50, 5.0, 20.0)])

    changes = {c['ticker']: c for c in _data._changes_between(curr, prev)}
    assert changes['NEW']['type'] == 'NEW'
    assert changes['NEW']['activeWeightDelta'] == 20.0


def test_removed_position_is_negative_active():
    from api import data as _data

    prev = _rows('FUND', [('AAA', 100, 10.0, 50.0), ('GONE', 100, 10.0, 50.0)])
    curr = _rows('FUND', [('AAA', 200, 10.0, 100.0)])

    changes = {c['ticker']: c for c in _data._changes_between(curr, prev)}
    assert changes['GONE']['type'] == 'REMOVED'
    assert changes['GONE']['activeWeightDelta'] < 0


def test_degrades_to_raw_weight_when_price_is_unknown():
    """Providers without Market Value must keep working exactly as before.

    With no usable price we assume no drift, so activeWeightDelta collapses to
    the raw weight change. This is what keeps the older fixtures — and any
    provider that stops reporting market value — behaving identically.
    """
    from api import data as _data

    prev = [{'ETF Ticker': 'F', 'Ticker': 'AAA', 'Name': 'A', 'Sector': '',
             'Share Quantity': '100', 'Weight': '40.0', 'Option_Type': ''},
            {'ETF Ticker': 'F', 'Ticker': 'BBB', 'Name': 'B', 'Sector': '',
             'Share Quantity': '100', 'Weight': '60.0', 'Option_Type': ''}]
    curr = [{'ETF Ticker': 'F', 'Ticker': 'AAA', 'Name': 'A', 'Sector': '',
             'Share Quantity': '150', 'Weight': '55.0', 'Option_Type': ''},
            {'ETF Ticker': 'F', 'Ticker': 'BBB', 'Name': 'B', 'Sector': '',
             'Share Quantity': '100', 'Weight': '45.0', 'Option_Type': ''}]

    changes = {c['ticker']: c for c in _data._changes_between(curr, prev)}
    assert changes['AAA']['activeWeightDelta'] == changes['AAA']['weightDelta'], \
        "AAA: no-price fallback must equal the raw delta"
    assert changes['AAA']['direction'] == 'buying'
    # BBB's shares did not move: its weight only fell because AAA was bought
    # with new money. The share-count guard makes that 0, not a -15pp "trim".
    assert changes['BBB']['weightDelta'] == -15.0
    assert changes['BBB']['activeWeightDelta'] == 0.0
    assert changes['BBB']['direction'] == 'unchanged'


def test_options_sleeve_included_in_renormalization():
    """Weights sum to 100 across the whole book, options included.

    If the option sleeve were dropped from the drift denominator, the equity
    weights would renormalize against the wrong base and every equity in an
    income fund would show a phantom active move.
    """
    from api import data as _data

    # AAA 100sh @$10 = 1000; call 10 @$40 = 400. Book = 1400.
    prev = _rows('FUND', [('AAA', 100, 10.0, 71.429)])
    prev.append({'ETF Ticker': 'FUND', 'Ticker': 'AAA  260101C00100000',
                 'Name': 'AAA CALL', 'Sector': '', 'Share Quantity': '10',
                 'Market Value': '400', 'Weight': '28.571', 'Option_Type': 'CALL'})
    # Nothing traded; AAA flat, the option premium decays by half. Book = 1200.
    curr = _rows('FUND', [('AAA', 100, 10.0, 83.333)])
    curr.append({'ETF Ticker': 'FUND', 'Ticker': 'AAA  260101C00100000',
                 'Name': 'AAA CALL', 'Sector': '', 'Share Quantity': '10',
                 'Market Value': '200', 'Weight': '16.667', 'Option_Type': 'CALL'})

    changes = {c['ticker']: c for c in _data._changes_between(curr, prev)}
    aaa = changes['AAA']
    assert aaa['weightDelta'] > 11, "raw weight rises purely from theta decay"
    assert abs(aaa['activeWeightDelta']) < 0.05, \
        f"option decay leaked into the equity's active weight: {aaa['activeWeightDelta']}"


def test_stock_split_is_not_a_purchase():
    """The CRWD case, 2026-07-01 -> 07-02: 4:1 split, weight barely moved.

    Shares quadruple and price quarters. Nothing was bought.
    """
    from api import data as _data

    prev = _rows('FDRS', [('CRWD', 4395, 400.0, 50.0), ('OTH', 1000, 1758.0, 50.0)])
    curr = _rows('FDRS', [('CRWD', 17580, 100.0, 50.0), ('OTH', 1000, 1758.0, 50.0)])

    changes = {c['ticker']: c for c in _data._changes_between(curr, prev)}
    crwd = changes['CRWD']

    assert crwd['sharesDelta'] == 13185, "raw share move looks like a huge buy"
    assert crwd['splitFactor'] == 4.0
    assert abs(crwd['activeWeightDelta']) < 0.01, \
        f"split read as a discretionary buy: {crwd['activeWeightDelta']}"

    # And the split must not contaminate the untouched sibling. OTH emits no
    # change record at all (nothing moved), so check the drift map directly —
    # before the split fix, renormalization pushed it sharply negative.
    active = _data._active_weight_deltas(_data._build_map(curr), _data._build_map(prev))
    assert abs(active[('FDRS', 'OTH')]) < 0.01, \
        "split leaked into an untouched holding via renormalization"
    assert 'OTH' not in changes, "untouched holding should emit no change record"


def test_reverse_split_is_not_a_sale():
    from api import data as _data

    prev = _rows('FUND', [('RVS', 10000, 1.0, 50.0), ('OTH', 100, 100.0, 50.0)])
    curr = _rows('FUND', [('RVS', 1000, 10.0, 50.0), ('OTH', 100, 100.0, 50.0)])

    changes = {c['ticker']: c for c in _data._changes_between(curr, prev)}
    assert changes['RVS']['splitFactor'] == 0.1
    assert abs(changes['RVS']['activeWeightDelta']) < 0.01


def test_aggressive_buy_is_not_mistaken_for_a_split():
    """A manager quadrupling a position on a flat tape must stay a BUY.

    This is the false-positive the value-preservation check exists to prevent.
    """
    from api import data as _data

    prev = _rows('FUND', [('AAA', 100, 10.0, 20.0), ('OTH', 100, 40.0, 80.0)])
    # 4x the shares at an unchanged price: value quadruples => a real buy.
    curr = _rows('FUND', [('AAA', 400, 10.0, 50.0), ('OTH', 100, 40.0, 50.0)])

    changes = {c['ticker']: c for c in _data._changes_between(curr, prev)}
    assert 'splitFactor' not in changes['AAA'], "real buy misclassified as a split"
    assert changes['AAA']['activeWeightDelta'] > 25


def test_signals_direction_follows_active_not_raw():
    """End-to-end: a rallying stock being sold must land in `selling`."""
    from api import data as _data

    prev = _rows('ARKK', [('AMD', 1000, 100.0, 50.0), ('OTH', 1000, 100.0, 50.0)])
    curr = _rows('ARKK', [('AMD', 900, 130.0, 53.917), ('OTH', 1000, 100.0, 46.083)])

    changes = _data._changes_between(curr, prev)
    signals = _data._signals_from(changes)

    selling = {s['ticker'] for s in signals['selling']}
    buying = {s['ticker'] for s in signals['buying']}
    assert 'AMD' in selling, "AMD was sold; raw weight would have put it in buying"
    assert 'AMD' not in buying

    amd = next(s for s in signals['selling'] if s['ticker'] == 'AMD')
    # Sign of the reported delta must agree with the reported direction.
    assert amd['weightDelta'] < 0
    # ...while the price-inclusive figure is preserved and still positive.
    assert amd['rawWeightDelta'] > 0


def test_divergence_surfaces_when_price_masks_it():
    """Two funds trade against each other on a green day.

    Raw weight pushes both the same way, hiding the divergence entirely.
    """
    from api import data as _data

    prev = (_rows('ARKK', [('AAA', 100, 10.0, 50.0), ('OTH', 100, 10.0, 50.0)])
            + _rows('AVUV', [('AAA', 100, 10.0, 50.0), ('OTH', 100, 10.0, 50.0)]))
    # AAA rallies to $12 for both funds.
    # ARKK buys 50 more AAA: 150*12=1800 vs OTH 1000 -> 64.3% / 35.7%
    # AVUV sells 50 AAA:      50*12=600  vs OTH 1000 -> 37.5% / 62.5%
    curr = (_rows('ARKK', [('AAA', 150, 12.0, 64.286), ('OTH', 100, 10.0, 35.714)])
            + _rows('AVUV', [('AAA', 50, 12.0, 37.5), ('OTH', 100, 10.0, 62.5)]))

    changes = _data._changes_between(curr, prev)
    by = {(c['fund'], c['ticker']): c for c in changes}

    # Both funds' raw AAA weight moved the same direction? ARKK up, AVUV down
    # here — but the active split is what must be right, and unambiguous.
    assert by[('ARKK', 'AAA')]['activeWeightDelta'] > 0
    assert by[('AVUV', 'AAA')]['activeWeightDelta'] < 0

    divs = {d['ticker']: d for d in _data._divergences_from(changes)}
    assert 'AAA' in divs, "genuine cross-fund divergence not detected"
    assert 'ARKK' in divs['AAA']['buying']
    assert 'AVUV' in divs['AAA']['selling']


# ---------------------------------------------------------------------------
# The share-count guard (2026-10-20). Measured on the live board that day:
# 1,123 of 3,381 rows with a real share move carried an active sign opposite
# to the trade. AVUS added 5,170 AMZN and was badged TRIM; ARKG sold 26,523
# TXG and read as a +0.21pp buy. A fund that added shares is never selling.
# ---------------------------------------------------------------------------


def test_buy_smaller_than_pro_rata_inflow_is_not_a_trim():
    """The AVUS/AMZN case: +10% creation units, AMZN only +2%. Shares went UP."""
    from api import data as _data

    prev = _rows('FUND', [('AMZN', 1000, 10.0, 50.0), ('OTH', 1000, 10.0, 50.0)])
    # Prices flat. Fund grows 10% in shares overall; AMZN gets +2%, OTH +18%.
    # AMZN: 1020*10 = 10200; OTH: 1180*10 = 11800; total 22000.
    curr = _rows('FUND', [('AMZN', 1020, 10.0, 46.364), ('OTH', 1180, 10.0, 53.636)])

    changes = {c['ticker']: c for c in _data._changes_between(curr, prev)}
    amzn = changes['AMZN']
    assert amzn['sharesDelta'] == 20, "the fund bought shares"
    assert amzn['weightDelta'] < 0, "raw weight fell (the rest of the book grew faster)"
    assert amzn['direction'] == 'buying', "shares up is never a trim"
    assert amzn['activeWeightDelta'] == 0.0, \
        f"an opposite-sign relative tilt is not a signal: {amzn['activeWeightDelta']}"
    assert changes['OTH']['direction'] == 'buying'
    assert changes['OTH']['activeWeightDelta'] > 0


def test_sale_smaller_than_redemption_is_not_an_add():
    """The ARKK/AMZN case: fund shrinks 10%, AMZN only -2%. Shares went DOWN."""
    from api import data as _data

    prev = _rows('FUND', [('AMZN', 1000, 10.0, 50.0), ('OTH', 1000, 10.0, 50.0)])
    curr = _rows('FUND', [('AMZN', 980, 10.0, 54.444), ('OTH', 820, 10.0, 45.556)])

    changes = {c['ticker']: c for c in _data._changes_between(curr, prev)}
    amzn = changes['AMZN']
    assert amzn['sharesDelta'] == -20
    assert amzn['weightDelta'] > 0
    assert amzn['direction'] == 'selling', "shares down is never an add"
    assert amzn['activeWeightDelta'] == 0.0
    assert changes['OTH']['direction'] == 'selling'
    assert changes['OTH']['activeWeightDelta'] < 0


def test_direction_follows_shares_and_sign_never_disagrees():
    """Every record: NEW buys, REMOVED sells, otherwise the share count rules,
    and activeWeightDelta's sign is a subset of direction."""
    from api import data as _data

    prev = _rows('FUND', [('AAA', 100, 10.0, 25.0), ('BBB', 100, 10.0, 25.0),
                          ('CCC', 100, 10.0, 25.0), ('GONE', 100, 10.0, 25.0)])
    # AAA bought, BBB sold, CCC untouched (price doubled), GONE closed, NEW opened.
    curr = _rows('FUND', [('AAA', 150, 10.0, 30.0), ('BBB', 50, 10.0, 10.0),
                          ('CCC', 100, 20.0, 40.0), ('NEW', 100, 10.0, 20.0)])

    changes = {c['ticker']: c for c in _data._changes_between(curr, prev)}
    assert changes['AAA']['direction'] == 'buying'
    assert changes['BBB']['direction'] == 'selling'
    assert changes['CCC']['direction'] == 'unchanged'
    assert changes['CCC']['activeWeightDelta'] == 0.0, "a rally is not a trade"
    assert changes['GONE']['direction'] == 'selling'
    assert changes['NEW']['direction'] == 'buying'
    for c in changes.values():
        a = c['activeWeightDelta']
        if a > 0:
            assert c['direction'] == 'buying', c
        elif a < 0:
            assert c['direction'] == 'selling', c


def test_split_adjusted_shares_decide_direction():
    """4:1 split plus a small real trim: 100 -> 390 shares is a sale, not a 4x buy."""
    from api import data as _data

    prev = _rows('FUND', [('SPL', 100, 400.0, 50.0), ('OTH', 1000, 40.0, 50.0)])
    # 400 post-split shares would be flat; 395 means 5 were sold.
    # SPL: 395*100 = 39500; OTH: 40000 (cash from the sale sits outside). 79500.
    curr = _rows('FUND', [('SPL', 395, 100.0, 49.686), ('OTH', 1000, 40.0, 50.314)])

    changes = {c['ticker']: c for c in _data._changes_between(curr, prev)}
    spl = changes['SPL']
    assert spl['splitFactor'] == 4.0
    assert spl['sharesDelta'] == 295, "raw share move still reported for transparency"
    assert spl['direction'] == 'selling'
    assert spl['activeWeightDelta'] <= 0


def test_unknown_share_counts_keep_the_drift_figure():
    """A weight-only provider (shares 0) has no count to check against."""
    from api import data as _data

    prev = _rows('FUND', [('AAA', 0, 0.0, 50.0), ('BBB', 0, 0.0, 50.0)])
    curr = _rows('FUND', [('AAA', 0, 0.0, 60.0), ('BBB', 0, 0.0, 40.0)])

    changes = {c['ticker']: c for c in _data._changes_between(curr, prev)}
    assert changes['AAA']['activeWeightDelta'] == 10.0
    assert changes['AAA']['direction'] == 'buying'
    assert changes['BBB']['activeWeightDelta'] == -10.0
    assert changes['BBB']['direction'] == 'selling'


def test_changes_direction_filter_uses_share_count():
    """`/changes?direction=buying` returns the fund that added shares even when
    its active tilt rounds to 0 — and never a fund whose count fell."""
    from api import data as _data

    prev = _rows('FUND', [('AMZN', 1000, 10.0, 50.0), ('OTH', 1000, 10.0, 50.0)])
    curr = _rows('FUND', [('AMZN', 1020, 10.0, 46.364), ('OTH', 1180, 10.0, 53.636)])
    changes = _data._changes_between(curr, prev)
    buying = [c['ticker'] for c in changes if c['direction'] == 'buying']
    selling = [c['ticker'] for c in changes if c['direction'] == 'selling']
    assert sorted(buying) == ['AMZN', 'OTH']
    assert selling == []
