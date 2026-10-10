"""
income.py — option-income fund analytics.

"Income ETF" is not one thing. Measured across the live book, the funds we
track fall into five structurally different shapes, and a single view that
renders them identically lies about four of them:

  A. COVERED_CALL   a real equity sleeve with calls written against it
                    (ULTY, KYLD, KQQQ, EGGQ/Y/S, ULTI, BLOX)
  B. SYNTHETIC      no shares at all — T-bills plus a long-call/short-put
                    synthetic, overwritten for income
                    (MSTY, NVDY, CONY, TSLY, HOOY, PLTY, NVII, TSII, YBTC)
  C. LEAP_PROXY     deep-ITM long index calls as the exposure, income written
                    intraday as 0DTE and therefore ABSENT from any end-of-day
                    holdings file (QDTE, XDTE, RDTE)
  D. SWAP           total-return swap, zero option rows (NVDW, MSTW, COIW ...)
  E. SHORT_EQUITY   short stock positions (SLTY)

Rendering "top holdings" for a SYNTHETIC fund shows four Treasury bills. For a
LEAP_PROXY fund the income leg cannot be shown at all — not because of a
scraper bug, but because the contracts open and expire inside one session.
Saying so is the honest thing; every other ETF site silently renders the seven
rows it can see and lets the reader assume that's the whole story.

Metric conventions
──────────────────
  * `Share Quantity` on an option row is CONTRACTS and is SIGNED.
    Negative = written/short. This is the single most load-bearing field here.
  * The contract multiplier is 100. Verified against the file:
    2884 contracts x $0.475 x 100 = $136,990.00 = the row's Market Value.
  * `Moneyness` is the scraper's own convention: (S-K)/K for calls,
    (K-S)/K for puts, so POSITIVE means in-the-money for both.
    "Upside room" below is (K-S)/S instead — what a holder actually keeps —
    and the two are deliberately reported separately.
  * `Underlying_Price` is missing for some funds and disagrees with the fund's
    own marked share price on others, so spot is resolved per underlying with
    an explicit disagreement guard. Never silently render a bad moneyness.
"""

from __future__ import annotations

from collections import defaultdict

from .data import (
    EXCLUDED_FUNDS,
    _SECTOR_FALLBACK,
    get_fund_aum,
    get_fund_aum_usd,
    FUND_PROVIDERS,
    _clean_ticker,
    _nullable_float,
    _safe_float,
    get_as_of_date,
    get_fund_category,
    get_latest_holdings,
)

CONTRACT_MULTIPLIER = 100

# Spot from the fund's own book vs. the scraper's quote feed can disagree —
# measured worst case RDDT at $178.04 vs $137.60 (22.7%) across three funds at
# once. Past this gap we suppress moneyness rather than render a wrong badge.
_SPOT_DISAGREEMENT_TOLERANCE = 0.05

ARCHETYPES = {
    'covered-call': {
        'label': 'Covered call on a real equity sleeve',
        'summary': 'Owns the stocks and writes calls against them.',
    },
    'synthetic': {
        'label': 'Synthetic long — no shares held',
        'summary': 'Owns Treasuries plus an options structure that replicates the '
                   'underlying. Nothing here is a stock position.',
    },
    'leap-proxy': {
        'label': 'Deep-ITM LEAP proxy + intraday overwrite',
        'summary': 'Long-dated index calls provide the exposure. The income leg is '
                   'written and expires the same session, so it never appears in an '
                   'end-of-day holdings file.',
    },
    'swap': {
        'label': 'Total-return swap',
        'summary': 'Exposure comes from a swap contract, not options or shares.',
    },
    'short-equity': {
        'label': 'Short equity income',
        'summary': 'Holds short stock positions — every sign in the book inverts.',
    },
    'unknown': {
        'label': 'Structure not yet classified',
        'summary': 'Not enough of a book in the latest snapshot to classify.',
    },
}

_TREASURY_HINTS = ('TREASURY', 'T-BILL', 'TBILL', 'BILL ')
_CASH_HINTS = ('CASH', 'MONEY MARKET', 'MMKT', 'OBLIGATIONS', 'GOVERNMENT & AGENCY',
               'NET OTHER', 'OTHER ASSET', 'PAYABLE', 'RECEIVABLE')
_SWAP_HINTS = ('SWAP', 'WEEKLYPAY')
_CASH_TICKERS = {'WEEK', 'B', 'TBILL', 'CASH'}


def _is_option(r: dict) -> bool:
    return bool((r.get('Option_Type') or '').strip())


def _sleeve_of(r: dict) -> str:
    """Bucket a non-option row: 'treasury', 'cash', 'swap' or 'equity'."""
    name = (r.get('Name') or '').upper()
    ticker = _clean_ticker(r.get('Ticker', '')).upper()
    if any(h in name for h in _SWAP_HINTS):
        return 'swap'
    if any(h in name for h in _TREASURY_HINTS) or ticker in _CASH_TICKERS:
        return 'treasury'
    if any(h in name for h in _CASH_HINTS) or (len(ticker) == 5 and ticker.endswith('XX')):
        return 'cash'
    return 'equity'


def _classify(sleeves: dict[str, float], opt: dict[str, float],
              n_options: int, n_equity: int) -> str:
    """Assign one of the five archetypes from the composition of the book."""
    equity = sleeves.get('equity', 0.0)
    if sleeves.get('swap', 0.0) > 10 and n_options == 0:
        return 'swap'
    if n_options == 0:
        return 'swap' if sleeves.get('swap', 0.0) > 0 else 'unknown'
    if equity < -5:
        return 'short-equity'
    # Long options carry the exposure and nothing is written: the income leg is
    # intraday and structurally invisible to an end-of-day file.
    if opt['long'] > 40 and abs(opt['short']) < 0.5:
        return 'leap-proxy'
    if equity < 30 and sleeves.get('treasury', 0.0) > 40:
        return 'synthetic'
    if equity >= 30:
        return 'covered-call'
    return 'unknown'


def _resolve_spot(equity_price: float | None, quoted: float | None) -> tuple[float | None, bool]:
    """Pick a spot price for an underlying, flagging an unusable disagreement.

    Prefers the fund's own marked share price when it also holds the stock —
    that is the same source as the position it is written against. Falls back
    to the scraper's quote. Returns (spot, suppressed).
    """
    if equity_price and quoted:
        gap = abs(equity_price - quoted) / equity_price
        if gap > _SPOT_DISAGREEMENT_TOLERANCE:
            return None, True
        return equity_price, False
    return (equity_price or quoted), False


def _fund_nav(rows: list[dict]) -> float | None:
    """NetAssets, or derive it from any row with both Market Value and Weight.

    Kurv and REX leave NetAssets blank, so the derivation is the only way to
    express their coverage as a share of NAV.
    """
    for r in rows:
        na = _nullable_float(r.get('NetAssets'))
        if na:
            return na
    for r in rows:
        mv = _nullable_float(r.get('Market Value'))
        w = _nullable_float(r.get('Weight'))
        if mv and w:
            return mv / (w / 100.0)
    return None


def build_fund_book(fund: str, rows: list[dict]) -> dict:
    """Assemble the one-screen view for a single income fund."""
    equities = [r for r in rows if not _is_option(r)]
    options = [r for r in rows if _is_option(r)]

    sleeves: dict[str, float] = defaultdict(float)
    equity_rows: dict[str, dict] = {}
    for r in equities:
        w = _safe_float(r.get('Weight', '0'))
        sleeve = _sleeve_of(r)
        sleeves[sleeve] += w
        if sleeve == 'equity':
            ticker = _clean_ticker(r.get('Ticker', ''))
            shares = _safe_float(r.get('Share Quantity', '0'))
            mv = _nullable_float(r.get('Market Value'))
            equity_rows[ticker] = {
                'ticker': ticker,
                'name': r.get('Name', ''),
                'weight': round(w, 4),
                'shares': shares,
                # The fund's own mark — same source as the position the calls
                # are written against, so it beats an external quote.
                'price': round(mv / shares, 4) if mv and shares else None,
            }

    opt_weight = {'long': 0.0, 'short': 0.0}
    for r in options:
        w = _safe_float(r.get('Weight', '0'))
        opt_weight['short' if w < 0 else 'long'] += w

    archetype = _classify(sleeves, opt_weight, len(options), len(equity_rows))
    nav = _fund_nav(rows)

    # ─── Group the option book by underlying ─────────────────────────────────
    by_underlying: dict[str, dict] = {}
    for r in options:
        underlying = (r.get('Underlying_Ticker') or '').strip() or _clean_ticker(r.get('Ticker', ''))
        contracts = _safe_float(r.get('Share Quantity', '0'))
        strike = _safe_float(r.get('Option_Strike', '0'))
        opt_type = (r.get('Option_Type') or '').strip()
        is_short = contracts < 0 or _safe_float(r.get('Weight', '0')) < 0

        leg = {
            'optionType': opt_type,
            'strike': strike,
            'expiry': r.get('Option_Expiry', ''),
            'dte': _nullable_float(r.get('DTE')),
            'contracts': contracts,
            'weight': round(_safe_float(r.get('Weight', '0')), 4),
            'written': is_short,
            'moneyness': _nullable_float(r.get('Moneyness')),
            'quotedSpot': _nullable_float(r.get('Underlying_Price')),
        }
        entry = by_underlying.setdefault(underlying, {
            'underlying': underlying,
            'legs': [],
            'equity': equity_rows.get(underlying),
        })
        entry['legs'].append(leg)

    # ─── Per-underlying roll-up ──────────────────────────────────────────────
    book: list[dict] = []
    for underlying, entry in by_underlying.items():
        eq = entry['equity']
        quoted = next((l['quotedSpot'] for l in entry['legs'] if l['quotedSpot']), None)
        spot, suppressed = _resolve_spot(eq['price'] if eq else None, quoted)

        written_calls = [l for l in entry['legs'] if l['written'] and l['optionType'].upper().startswith('C')]
        written_puts = [l for l in entry['legs'] if l['written'] and l['optionType'].upper().startswith('P')]
        long_legs = [l for l in entry['legs'] if not l['written']]

        primary = min(written_calls, key=lambda l: (l['dte'] is None, l['dte'] or 0)) if written_calls else None

        room = None
        if primary and spot:
            room = (primary['strike'] - spot) / spot * 100.0

        covered = None
        if eq and eq['shares'] and written_calls:
            written_contracts = sum(abs(l['contracts']) for l in written_calls)
            covered = min(1.0, written_contracts * CONTRACT_MULTIPLIER / eq['shares'])

        book.append({
            'underlying': underlying,
            'equity': eq,
            'spot': round(spot, 4) if spot else None,
            'spotSuppressed': suppressed,
            'writtenCall': primary,
            'writtenCallCount': len(written_calls),
            'writtenPutCount': len(written_puts),
            'longLegs': [
                {'optionType': l['optionType'], 'strike': l['strike'],
                 'expiry': l['expiry'], 'dte': l['dte'], 'contracts': l['contracts']}
                for l in long_legs
            ],
            'coveredFraction': round(covered, 4) if covered is not None else None,
            'upsideRoomPct': round(room, 2) if room is not None else None,
            'capped': bool(room is not None and room <= 0),
            'optionWeight': round(sum(l['weight'] for l in entry['legs']), 4),
            'legCount': len(entry['legs']),
        })

    book.sort(key=lambda b: -( (b['equity']['weight'] if b['equity'] else 0)
                               or abs(b['optionWeight']) ))

    return {
        'fund': fund,
        'provider': FUND_PROVIDERS.get(fund, 'Other'),
        'aum': get_fund_aum(fund),
        'aumUsd': get_fund_aum_usd(fund),
        'archetype': archetype,
        'archetypeLabel': ARCHETYPES[archetype]['label'],
        'archetypeSummary': ARCHETYPES[archetype]['summary'],
        'netAssets': nav,
        'sleeves': {
            'equity': round(sleeves.get('equity', 0.0), 3),
            'treasury': round(sleeves.get('treasury', 0.0), 3),
            'cash': round(sleeves.get('cash', 0.0), 3),
            'swap': round(sleeves.get('swap', 0.0), 3),
            'optionsLong': round(opt_weight['long'], 3),
            'optionsShort': round(opt_weight['short'], 3),
        },
        'counts': {
            'equityPositions': len(equity_rows),
            'optionLegs': len(options),
            'underlyings': len(by_underlying),
        },
        'tiles': _coverage_tiles(book, options, sleeves, nav, archetype),
        'book': book,
        **dict(zip(('positions', 'otherPositions', 'positionsSummary'),
                   build_positions(equities, options, nav))),
        # LEAP_PROXY funds hold long exposure and write nothing we can see.
        # Flagged explicitly so the UI states the gap instead of implying the
        # fund has no income strategy.
        'incomeLegVisible': archetype != 'leap-proxy',
    }


def _coverage_tiles(book: list[dict], options: list[dict], sleeves: dict[str, float],
                    nav: float | None, archetype: str) -> dict:
    """The six headline numbers. Each is None when it isn't computable."""
    written_calls = [
        r for r in options
        if (r.get('Option_Type') or '').upper().startswith('C')
        and _safe_float(r.get('Share Quantity', '0')) < 0
    ]
    written_any = [r for r in options if _safe_float(r.get('Share Quantity', '0')) < 0]

    # M1 — share of the equity sleeve carrying a written call.
    covered_weight = sum(
        (b['equity']['weight'] * b['coveredFraction'])
        for b in book
        if b['equity'] and b['coveredFraction'] is not None
    )
    equity_weight = sum(b['equity']['weight'] for b in book if b['equity'])
    # Names held as equity but with no option leg at all still belong in the
    # denominator — they are the uncovered part of the sleeve.
    total_equity = sleeves.get('equity', 0.0)
    call_coverage = (covered_weight / total_equity * 100.0) if total_equity > 0 else None

    # M2 — weight-weighted moneyness of the written book (positive = ITM).
    mny_num = mny_den = 0.0
    for r in written_calls:
        m = _nullable_float(r.get('Moneyness'))
        if m is None:
            continue
        w = abs(_safe_float(r.get('Weight', '0')))
        mny_num += w * m
        mny_den += w
    weighted_moneyness = (mny_num / mny_den * 100.0) if mny_den else None

    # M3 — weight-weighted DTE across everything written.
    dte_num = dte_den = 0.0
    for r in written_any:
        d = _nullable_float(r.get('DTE'))
        if d is None:
            continue
        w = abs(_safe_float(r.get('Weight', '0')))
        dte_num += w * d
        dte_den += w
    weighted_dte = (dte_num / dte_den) if dte_den else None

    # M4 — equity-weighted upside room to the written strike.
    room_num = room_den = 0.0
    for b in book:
        if b['equity'] and b['upsideRoomPct'] is not None:
            room_num += b['equity']['weight'] * b['upsideRoomPct']
            room_den += b['equity']['weight']
    upside_room = (room_num / room_den) if room_den else None

    # M5 — how much of the sleeve is already past its cap.
    capped = [b for b in book if b['capped']]
    with_calls = [b for b in book if b['writtenCall']]

    # M6 — notional coverage as a share of NAV.
    call_notional = put_notional = 0.0
    notional_ok = nav is not None
    for r in options:
        contracts = _safe_float(r.get('Share Quantity', '0'))
        if contracts >= 0:
            continue
        spot = _nullable_float(r.get('Underlying_Price'))
        if spot is None:
            notional_ok = False
            continue
        notional = abs(contracts) * CONTRACT_MULTIPLIER * spot
        if (r.get('Option_Type') or '').upper().startswith('C'):
            call_notional += notional
        else:
            put_notional += notional

    return {
        'callCoveragePct': round(call_coverage, 1) if call_coverage is not None else None,
        'weightedMoneynessPct': round(weighted_moneyness, 2) if weighted_moneyness is not None else None,
        'weightedDte': round(weighted_dte, 1) if weighted_dte is not None else None,
        'upsideRoomPct': round(upside_room, 2) if upside_room is not None else None,
        'cappedNames': len(capped),
        'namesWithWrittenCalls': len(with_calls),
        'collateralPct': round(sleeves.get('cash', 0.0) + sleeves.get('treasury', 0.0), 2),
        'callNotionalPctNav': round(call_notional / nav * 100.0, 1) if notional_ok and nav else None,
        'putNotionalPctNav': round(put_notional / nav * 100.0, 1) if notional_ok and nav else None,
        'writtenCallLegs': len(written_calls),
        'writtenLegs': len(written_any),
    }


# ─── Brokerage-style positions view ──────────────────────────────────────────
# The book above is organised around the option legs. A reader who wants to
# know "how much of this fund's stock is covered?" needs the other shape — the
# one every brokerage shows: one row per stock, its option legs tucked under
# it, and a covered/uncovered split.
#
# Stock comes in two forms here. Shares held outright, and synthetic shares: a
# long call + short put at the same strike/expiry/size, which is how KQQQ,
# GDXY and the YieldMax single-name funds hold their underlying. Counting only
# the outright shares would report MSTY as 0% covered when every one of its
# written calls sits on synthetic stock. Pairing is shared with the
# effectiveness engine (effectiveness.split_synthetic_legs) so the two views
# can't disagree about what a synthetic is.

def _leg_role(contracts: float, opt_type: str, synthetic: bool) -> str:
    if synthetic:
        return 'synthetic'
    side = 'written' if contracts < 0 else 'long'
    return f"{side}-{'call' if opt_type.upper().startswith('C') else 'put'}"


def build_positions(equities: list[dict], options: list[dict],
                    nav: float | None) -> tuple[list[dict], list[dict], dict]:
    """Return (stock_positions, other_positions, summary).

    stock_positions: one row per stock (held outright and/or synthetically),
        with its option legs, sorted by exposure. Coverage is shares covered by
        live written calls ÷ total long shares (or written puts ÷ short shares
        for a short-equity book), capped at 100%.
    other_positions: T-bills, cash, swaps — collapsed to one row per sleeve.
    summary: exposure-weighted covered / uncovered split of the stock book.
    """
    from effectiveness import split_synthetic_legs, _is_live

    _, synthetic_rows, synthetic_shares = split_synthetic_legs(
        [o for o in options if _is_live(o)])
    synthetic_ids = {id(o) for o in synthetic_rows}

    stocks: dict[str, dict] = {}
    other: dict[str, dict] = {}
    sleeve_labels = {'treasury': 'Treasury bills & notes', 'cash': 'Cash & money market',
                     'swap': 'Swaps'}

    for r in equities:
        sleeve = _sleeve_of(r)
        mv = _nullable_float(r.get('Market Value')) or 0.0
        w = _safe_float(r.get('Weight', '0'))
        if sleeve != 'equity':
            o = other.setdefault(sleeve, {'sleeve': sleeve, 'label': sleeve_labels[sleeve],
                                          'marketValue': 0.0, 'weight': 0.0, 'lines': 0})
            o['marketValue'] += mv
            o['weight'] += w
            o['lines'] += 1
            continue
        ticker = _clean_ticker(r.get('Ticker', ''))
        if not ticker:
            continue
        shares = _safe_float(r.get('Share Quantity', '0'))
        st = stocks.setdefault(ticker, {
            'ticker': ticker, 'name': r.get('Name', ''), 'sector': '', 'shares': 0.0,
            'marketValue': 0.0, 'weight': 0.0, 'price': None, 'legs': [],
        })
        st['sector'] = st['sector'] or (r.get('Sector') or '').strip()
        st['shares'] += shares
        st['marketValue'] += mv
        st['weight'] += w
        if shares and mv:
            st['price'] = mv / shares

    for r in options:
        underlying = (r.get('Underlying_Ticker') or '').strip() or _clean_ticker(r.get('Ticker', ''))
        contracts = _safe_float(r.get('Share Quantity', '0'))
        opt_type = (r.get('Option_Type') or '').strip()
        mv = _nullable_float(r.get('Market Value'))
        st = stocks.setdefault(underlying, {
            'ticker': underlying, 'name': '', 'sector': '', 'shares': 0.0,
            'marketValue': 0.0, 'weight': 0.0, 'price': None, 'legs': [],
        })
        if st['price'] is None:
            st['quotedSpot'] = st.get('quotedSpot') or _nullable_float(r.get('Underlying_Price'))
        strike = _safe_float(r.get('Option_Strike', '0'))
        st['legs'].append({
            'role': _leg_role(contracts, opt_type, id(r) in synthetic_ids),
            'optionType': opt_type,
            'strike': strike,
            'expiry': r.get('Option_Expiry', ''),
            'dte': _nullable_float(r.get('DTE')),
            'expired': not _is_live(r),
            'contracts': contracts,
            'price': round(mv / (contracts * CONTRACT_MULTIPLIER), 4) if mv and contracts else None,
            'marketValue': round(mv, 2) if mv is not None else None,
            'weight': round(_safe_float(r.get('Weight', '0')), 4),
        })

    positions: list[dict] = []
    covered_value = exposure_value = 0.0
    for t, st in stocks.items():
        synth = synthetic_shares.get(t, 0.0)
        total = st['shares'] + synth
        spot, suppressed = _resolve_spot(st['price'], st.pop('quotedSpot', None))
        live = [l for l in st['legs'] if not l['expired']]
        def _sh(role):
            return sum(abs(l['contracts']) for l in live if l['role'] == role) * CONTRACT_MULTIPLIER
        call_sh, put_sh = _sh('written-call'), _sh('written-put')
        if total > 0:
            covered_sh = min(call_sh, total)
            written_sh, wing_sh = call_sh, _sh('long-call')
        elif total < 0:
            covered_sh = min(put_sh, -total)
            written_sh, wing_sh = put_sh, _sh('long-put')
        else:
            covered_sh, written_sh, wing_sh = 0.0, call_sh + put_sh, _sh('long-call') + _sh('long-put')
        coverage = covered_sh / abs(total) if total else None

        for l in st['legs']:
            l['upsideRoomPct'] = (round((l['strike'] - spot) / spot * 100.0, 2)
                                  if spot and l['strike'] and l['role'] == 'written-call' else None)

        exposure = abs(total) * spot if spot else abs(st['marketValue'])
        if total and coverage is not None:
            exposure_value += exposure
            covered_value += exposure * coverage

        st['legs'].sort(key=lambda l: (l['role'] == 'synthetic', l['expiry'], l['strike']))
        positions.append({
            'ticker': t,
            'name': st['name'],
            # ~70% of rows arrive with a blank Sector; fall back to the same
            # ticker map the rest of the API uses (which also covers names
            # held only synthetically). Blank when neither knows.
            'sector': st['sector'] or _SECTOR_FALLBACK.get(t, ''),
            'sharesHeld': st['shares'],
            'syntheticShares': synth,
            'totalShares': total,
            'price': round(spot, 4) if spot else None,
            'spotSuppressed': suppressed,
            'marketValue': round(st['marketValue'], 2),
            'exposureValue': round(exposure, 2),
            'weight': round(st['weight'], 4),
            'exposurePctNav': round(exposure / nav * 100.0, 2) if nav else None,
            'coveredShares': covered_sh,
            'coveragePct': round(coverage * 100.0, 1) if coverage is not None else None,
            # Written beyond the shares held AND beyond any long wings of the
            # same type (a call spread caps the excess) — genuinely naked.
            'nakedShares': max(0.0, written_sh - abs(total) - wing_sh),
            'legs': st['legs'],
        })

    positions.sort(key=lambda p: -p['exposureValue'])
    others = sorted(
        ({**o, 'marketValue': round(o['marketValue'], 2), 'weight': round(o['weight'], 4)}
         for o in other.values()),
        key=lambda o: -o['marketValue'])

    covered_pct = covered_value / exposure_value * 100.0 if exposure_value else None
    synth_value = sum(abs(p['syntheticShares']) * p['price'] for p in positions
                      if p['price'] and p['syntheticShares'])
    summary = {
        'coveredPct': round(covered_pct, 1) if covered_pct is not None else None,
        'uncoveredPct': round(100.0 - covered_pct, 1) if covered_pct is not None else None,
        'syntheticPct': round(synth_value / exposure_value * 100.0, 1) if exposure_value else None,
        'stockExposureValue': round(exposure_value, 2),
        'coveredValue': round(covered_value, 2),
        'stockPositions': sum(1 for p in positions if p['totalShares']),
        'otherPctNav': round(sum(o['weight'] for o in others), 2),
    }
    return positions, others, summary


def get_income_overview() -> dict:
    """Every option-income fund, one row each — the /income index."""
    latest = get_latest_holdings()
    by_fund: dict[str, list[dict]] = defaultdict(list)
    for r in latest:
        fund = r.get('ETF Ticker', '')
        if not fund or fund in EXCLUDED_FUNDS:
            continue
        if get_fund_category(fund) != 'option-income':
            continue
        by_fund[fund].append(r)

    funds = []
    for fund in sorted(by_fund):
        book = build_fund_book(fund, by_fund[fund])
        funds.append({
            k: book[k] for k in (
                'fund', 'provider', 'aum', 'aumUsd', 'archetype', 'archetypeLabel',
                'archetypeSummary', 'netAssets', 'sleeves', 'counts', 'tiles',
                'incomeLegVisible',
            )
        })

    grouped: dict[str, list[dict]] = defaultdict(list)
    for f in funds:
        grouped[f['archetype']].append(f)

    return {
        'asOfDate': get_as_of_date(),
        'fundCount': len(funds),
        'funds': funds,
        'archetypes': [
            {
                'key': key,
                'label': ARCHETYPES[key]['label'],
                'summary': ARCHETYPES[key]['summary'],
                'funds': [f['fund'] for f in grouped[key]],
            }
            for key in ('covered-call', 'synthetic', 'leap-proxy', 'swap',
                        'short-equity', 'unknown')
            if grouped[key]
        ],
    }


def get_income_fund(fund: str) -> dict | None:
    """The full one-screen book for a single income fund."""
    fund = fund.upper()
    if get_fund_category(fund) != 'option-income':
        return None
    rows = [r for r in get_latest_holdings() if r.get('ETF Ticker', '') == fund]
    if not rows:
        return None
    book = build_fund_book(fund, rows)
    book['asOfDate'] = get_as_of_date()
    # Dated, contract-based option trades for the last 10 snapshots — paired
    # into rolls / spreads / synthetics (api/structures.py). Separate from
    # build_fund_book so the all-funds overview doesn't pay for it.
    from .structures import get_fund_option_activity
    book['optionActivity'] = get_fund_option_activity(fund, days=10)['days']
    return book
