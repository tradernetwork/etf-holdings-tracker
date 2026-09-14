"""
TickerTrace data layer — shared by FastAPI and FastMCP servers.

Reads CSV history files and computes signals, changes, sector flow,
divergences, streaks, briefings, and activity buckets. This is the
authoritative source of truth; `etf-dashboard/lib/holdings.ts` is deprecated
(review #10).
"""

import csv
import functools
import os
import re
from collections import defaultdict
from datetime import date, timedelta
from typing import Any

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'etf-dashboard', 'public', 'data')
HISTORY_DIR = os.path.join(DATA_DIR, 'history')

# IBIT/IVV/IWM: passive ETFs removed from scraping.
# MSII/COII/HOII/PLTI: REX Growth & Income funds liquidated 2026-06-16 (trading
# halted 2026-06-09). Filtered so their residual CSV history doesn't surface as
# stale/unlabeled rows. The history files are left on disk — reversible.
EXCLUDED_FUNDS = {'IBIT', 'IVV', 'IWM', 'MSII', 'COII', 'HOII', 'PLTI'}
JUNK_TICKERS = {'CASH', 'OTHER', 'USD', 'CASH&OTHER', '', 'DUMMY', 'TBD', 'B', 'WEEK', 'TBILL'}

# NYSE market holidays (YYYY-MM-DD in ET). Mirrors NYSE_HOLIDAYS in
# etf-dashboard/lib/marketHours.ts — keep the two in sync. Update annually.
# Streaks and week/month lookbacks count *trading days*, so non-market-day
# snapshot files (stray weekend scrapes, holiday runs) must be filtered out at
# read time — otherwise a "5-day streak" silently includes a Saturday, and a
# weekend bad-scrape pollutes the day-over-day delta.
_NYSE_HOLIDAYS = frozenset({
    # 2026
    '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
    '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
    # 2027
    '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
    '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
})


def _is_trading_day(iso: str) -> bool:
    """True if `iso` ('YYYY-MM-DD') is a weekday and not an NYSE holiday."""
    d = _parse_iso(iso)
    if d is None:
        return True  # unparseable — don't silently drop, let downstream handle
    return d.weekday() < 5 and iso not in _NYSE_HOLIDAYS

# Common money-market fund tickers. A bare '.endswith("XX")' matched real
# equities (IDXX = IDEXX Labs, SPXX), so this stayed an allowlist — but the
# allowlist silently missed AGPXX and FIGXX, and AGPXX became the #1 buying
# signal on the dashboard while FIGXX drove a top divergence.
#
# Mutual-fund tickers are always 5 characters; money-market ones end in XX.
# Across every snapshot on disk, every 5-char XX ticker is a money-market fund
# (FGXXX, AGPXX, FIGXX) and every shorter one is a real security (IDXX, SPXX).
# So the shape rule below is safe, and the allowlist stays for anything that
# doesn't fit the 5-char convention.
_MONEY_MARKET_FUNDS = frozenset({
    'FGXXX', 'SPAXX', 'TTTXX', 'FZFXX', 'FDRXX', 'SPRXX', 'FNSXX',
    'VMFXX', 'VMRXX', 'VUSXX', 'SWVXX', 'SNAXX', 'SNVXX', 'SNOXX',
    'AGPXX', 'FIGXX',
})


def _is_money_market(t: str) -> bool:
    """True for money-market fund tickers. See _MONEY_MARKET_FUNDS."""
    return t in _MONEY_MARKET_FUNDS or (len(t) == 5 and t.endswith('XX'))

# Valid ticker shape: starts with a letter, 1-10 chars, alphanumeric + dot/dash.
# Anything that fails this is almost certainly a CUSIP / ISIN / placeholder.
_VALID_TICKER_RE = re.compile(r'^[A-Z][A-Z0-9.\-]{0,9}$')


def _is_junk_ticker(ticker: str) -> bool:
    """
    True if the ticker should be hidden — cash placeholders, money-market funds,
    raw CUSIPs, Total-Return-Swap entries.

    Review #13: positive-allowlist on ticker shape instead of a tower of
    heuristics that also caught valid international tickers.
    """
    if not ticker:
        return True
    t = ticker.strip().upper()
    if t in JUNK_TICKERS or _is_money_market(t):
        return True
    if ' TRS ' in t:  # "88160R101 TRS 031926 NM"
        return True
    # Anything not matching the real-ticker shape is almost certainly an identifier.
    if not _VALID_TICKER_RE.match(t):
        return True
    return False


# Bloomberg exchange suffixes (ARK funds use these: "RKLB UQ", "NU UN", etc.)
_BLOOMBERG_SUFFIX_RE = re.compile(r'\s+(?:UQ|UN|UW|UP|UA|FP|LN|GY|SJ|AU|CT|CN|JP|HK|SW|SS|IT|SM|NA|BB|PL|DC|NO|AV|ID|MK|TB|PM|IJ)$')

def _clean_ticker(ticker: str) -> str:
    """Strip Bloomberg exchange suffixes and whitespace from ticker strings."""
    return _BLOOMBERG_SUFFIX_RE.sub('', ticker.strip())


# ─── Static sector fallback ──────────────────────────────────────────────────
# Most fund providers (ARK, Corgi, Roundhill, YieldMax, REX, Amplify thematic)
# don't include GICS sector in their holdings files — only Avantis does.  That
# means ~70% of holdings arrive with an empty Sector field, making the sector
# flow analysis largely blind to trades in tech, comm services, and financials.
#
# This table maps the ~100 most commonly held tickers to their GICS sector.  It
# is applied at read time (in _build_map and _blend_institutional) as a fallback
# when the CSV field is empty — it never overwrites a provider-supplied value.
_SECTOR_FALLBACK: dict[str, str] = {
    # Information Technology
    'AAPL': 'INFORMATION TECHNOLOGY',
    'MSFT': 'INFORMATION TECHNOLOGY',
    'NVDA': 'INFORMATION TECHNOLOGY',
    'AMD': 'INFORMATION TECHNOLOGY',
    'AVGO': 'INFORMATION TECHNOLOGY',
    'TSM': 'INFORMATION TECHNOLOGY',
    'INTC': 'INFORMATION TECHNOLOGY',
    'MU': 'INFORMATION TECHNOLOGY',
    'AMAT': 'INFORMATION TECHNOLOGY',
    'LRCX': 'INFORMATION TECHNOLOGY',
    'KLAC': 'INFORMATION TECHNOLOGY',
    'TXN': 'INFORMATION TECHNOLOGY',
    'QCOM': 'INFORMATION TECHNOLOGY',
    'MRVL': 'INFORMATION TECHNOLOGY',
    'PANW': 'INFORMATION TECHNOLOGY',
    'CRWD': 'INFORMATION TECHNOLOGY',
    'FTNT': 'INFORMATION TECHNOLOGY',
    'NET': 'INFORMATION TECHNOLOGY',
    'DDOG': 'INFORMATION TECHNOLOGY',
    'SNPS': 'INFORMATION TECHNOLOGY',
    'CDNS': 'INFORMATION TECHNOLOGY',
    'PLTR': 'INFORMATION TECHNOLOGY',
    'IBM': 'INFORMATION TECHNOLOGY',
    'WDC': 'INFORMATION TECHNOLOGY',
    'SNDK': 'INFORMATION TECHNOLOGY',
    'COHR': 'INFORMATION TECHNOLOGY',
    'CIEN': 'INFORMATION TECHNOLOGY',
    'LITE': 'INFORMATION TECHNOLOGY',
    'CRDO': 'INFORMATION TECHNOLOGY',
    'VRNS': 'INFORMATION TECHNOLOGY',
    'TER': 'INFORMATION TECHNOLOGY',
    'JKHY': 'INFORMATION TECHNOLOGY',
    'CRWV': 'INFORMATION TECHNOLOGY',
    'ORCL': 'INFORMATION TECHNOLOGY',
    'CRM': 'INFORMATION TECHNOLOGY',
    'NOW': 'INFORMATION TECHNOLOGY',
    'ADBE': 'INFORMATION TECHNOLOGY',
    'INTU': 'INFORMATION TECHNOLOGY',
    'ANET': 'INFORMATION TECHNOLOGY',
    'MCHP': 'INFORMATION TECHNOLOGY',
    'STX': 'INFORMATION TECHNOLOGY',
    'DELL': 'INFORMATION TECHNOLOGY',
    'HPQ': 'INFORMATION TECHNOLOGY',
    'ACN': 'INFORMATION TECHNOLOGY',
    'ON': 'INFORMATION TECHNOLOGY',
    'KEYS': 'INFORMATION TECHNOLOGY',
    'ZBRA': 'INFORMATION TECHNOLOGY',
    # Communication Services
    'GOOGL': 'COMMUNICATION SERVICES',
    'GOOG': 'COMMUNICATION SERVICES',
    'META': 'COMMUNICATION SERVICES',
    'NFLX': 'COMMUNICATION SERVICES',
    'SPOT': 'COMMUNICATION SERVICES',
    'RBLX': 'COMMUNICATION SERVICES',
    'DIS': 'COMMUNICATION SERVICES',
    'T': 'COMMUNICATION SERVICES',
    'VZ': 'COMMUNICATION SERVICES',
    'TMUS': 'COMMUNICATION SERVICES',
    'SNAP': 'COMMUNICATION SERVICES',
    'PINS': 'COMMUNICATION SERVICES',
    'RDDT': 'COMMUNICATION SERVICES',
    # Consumer Discretionary
    'AMZN': 'CONSUMER DISCRETIONARY',
    'TSLA': 'CONSUMER DISCRETIONARY',
    'NKE': 'CONSUMER DISCRETIONARY',
    'ETSY': 'CONSUMER DISCRETIONARY',
    'DASH': 'CONSUMER DISCRETIONARY',
    'ABNB': 'CONSUMER DISCRETIONARY',
    'LYFT': 'CONSUMER DISCRETIONARY',
    'EXPE': 'CONSUMER DISCRETIONARY',
    'MELI': 'CONSUMER DISCRETIONARY',
    'SE': 'CONSUMER DISCRETIONARY',
    'SHOP': 'CONSUMER DISCRETIONARY',
    'BKNG': 'CONSUMER DISCRETIONARY',
    'HD': 'CONSUMER DISCRETIONARY',
    'LOW': 'CONSUMER DISCRETIONARY',
    'TGT': 'CONSUMER DISCRETIONARY',
    'MCD': 'CONSUMER DISCRETIONARY',
    'CMG': 'CONSUMER DISCRETIONARY',
    'SBUX': 'CONSUMER DISCRETIONARY',
    'TJX': 'CONSUMER DISCRETIONARY',
    # Consumer Staples
    'WMT': 'CONSUMER STAPLES',
    'COST': 'CONSUMER STAPLES',
    'PG': 'CONSUMER STAPLES',
    'KO': 'CONSUMER STAPLES',
    'PEP': 'CONSUMER STAPLES',
    'MDLZ': 'CONSUMER STAPLES',
    # Financials
    'V': 'FINANCIALS',
    'MA': 'FINANCIALS',
    'COIN': 'FINANCIALS',
    'XYZ': 'FINANCIALS',    # Block Inc
    'ICE': 'FINANCIALS',
    'AXP': 'FINANCIALS',
    'PYPL': 'FINANCIALS',
    'NU': 'FINANCIALS',
    'BR': 'FINANCIALS',
    'GLBE': 'FINANCIALS',
    'CRCL': 'FINANCIALS',   # Circle Internet Group
    'ETOR': 'FINANCIALS',   # eToro
    'HOOD': 'FINANCIALS',
    'TOST': 'FINANCIALS',
    'GS': 'FINANCIALS',
    'MS': 'FINANCIALS',
    'JPM': 'FINANCIALS',
    'BAC': 'FINANCIALS',
    'SCHW': 'FINANCIALS',
    'BLK': 'FINANCIALS',
    # Industrials
    'UBER': 'INDUSTRIALS',
    'RKLB': 'INDUSTRIALS',
    'CAT': 'INDUSTRIALS',
    'RTX': 'INDUSTRIALS',
    'LMT': 'INDUSTRIALS',
    'FDX': 'INDUSTRIALS',
    'BWXT': 'INDUSTRIALS',
    'ESLT': 'INDUSTRIALS',
    'TDY': 'INDUSTRIALS',
    'UPS': 'INDUSTRIALS',
    'GE': 'INDUSTRIALS',
    'BA': 'INDUSTRIALS',
    'NOC': 'INDUSTRIALS',
    'GD': 'INDUSTRIALS',
    'SPCX': 'INDUSTRIALS',  # Space Exploration Technologies
    # Health Care
    'LLY': 'HEALTH CARE',
    'VCYT': 'HEALTH CARE',
    'TXG': 'HEALTH CARE',
    'MRNA': 'HEALTH CARE',
    'ABBV': 'HEALTH CARE',
    'PFE': 'HEALTH CARE',
    'JNJ': 'HEALTH CARE',
    'UNH': 'HEALTH CARE',
    'AMGN': 'HEALTH CARE',
    'GILD': 'HEALTH CARE',
    'VRTX': 'HEALTH CARE',
    'ISRG': 'HEALTH CARE',
    'REGN': 'HEALTH CARE',
    'BIIB': 'HEALTH CARE',
    # Energy
    'XOM': 'ENERGY',
    'CVX': 'ENERGY',
    'COP': 'ENERGY',
    'OXY': 'ENERGY',
    # Materials
    'STLD': 'MATERIALS',
    'NUE': 'MATERIALS',
    # Real Estate
    'AMT': 'REAL ESTATE',
    'CCI': 'REAL ESTATE',
    'EQIX': 'REAL ESTATE',
}


# ─── Significance thresholds (review #10 — porting from holdings.ts) ──────────
# Broad-index funds (AVUV/AVLV with 700+ holdings) need a smaller threshold to
# pick up real moves. Concentrated funds (ARK with 30-70 holdings) move bigger.
# Broad funds hold hundreds of names, so each position is a smaller slice of
# NAV and a 2bp move is genuinely significant. AVMV was missing here despite
# holding 286 positions — more than AVLV's 272 — so it was being judged on the
# concentrated threshold while its sibling got the broad one.
_BROAD_FUNDS = {'AVUV', 'AVLV', 'AVMV', 'AVEM', 'AVDV', 'AVDE', 'AVUS', 'AVSC', 'AVES', 'AVIV'}
_SIGNIFICANCE_BROAD = 0.01           # 1 bp
_SIGNIFICANCE_CONCENTRATED = 0.02    # 2 bps


def _significance_threshold(fund: str) -> float:
    """Minimum weightDelta magnitude (percentage points) that counts as a signal."""
    return _SIGNIFICANCE_BROAD if fund in _BROAD_FUNDS else _SIGNIFICANCE_CONCENTRATED

FUND_PROVIDERS = {
    'AVUV': 'Avantis', 'AVLV': 'Avantis', 'AVMV': 'Avantis',
    'AVEM': 'Avantis', 'AVDV': 'Avantis', 'AVDE': 'Avantis', 'AVUS': 'Avantis', 'AVSC': 'Avantis', 'AVES': 'Avantis', 'AVIV': 'Avantis',
    'ARKK': 'ARK Invest', 'ARKQ': 'ARK Invest', 'ARKW': 'ARK Invest',
    'ARKG': 'ARK Invest', 'ARKF': 'ARK Invest', 'ARKX': 'ARK Invest',
    'KYLD': 'Kurv', 'KQQQ': 'Kurv',
    'ULTY': 'YieldMax',
    'SLTY': 'YieldMax',
    'ULTI': 'REX Shares',
    'BLOX': 'Tidal / NicholasX',
    'EGGQ': 'Tidal / NestYield',
    'EGGY': 'Tidal / NestYield',
    'EGGS': 'Tidal / NestYield',
    # Weekly pay suite
    'MSTW': 'Roundhill', 'NVDW': 'Roundhill', 'COIW': 'Roundhill',
    'TSLW': 'Roundhill', 'HOOW': 'Roundhill', 'PLTW': 'Roundhill',
    'QDTE': 'Roundhill', 'XDTE': 'Roundhill', 'RDTE': 'Roundhill', 'YBTC': 'Roundhill',
    'MSTY': 'YieldMax', 'NVDY': 'YieldMax', 'CONY': 'YieldMax',
    'CHPY': 'YieldMax', 'YMAX': 'YieldMax', 'AMDY': 'YieldMax', 'AMZY': 'YieldMax', 'GOOY': 'YieldMax', 'GDXY': 'YieldMax',
    'TSLY': 'YieldMax', 'HOOY': 'YieldMax', 'PLTY': 'YieldMax',
    'NVII': 'REX Shares', 'TSII': 'REX Shares',
    # Corgi Funds — thematic + founder-led (launched May 2026)
    'EUV': 'Corgi Funds', 'CMAG': 'Corgi Funds', 'CQTM': 'Corgi Funds',
    'XA': 'Corgi Funds', 'EYES': 'Corgi Funds', 'KYC': 'Corgi Funds',
    'GNMX': 'Corgi Funds', 'AV': 'Corgi Funds', 'DOCK': 'Corgi Funds',
    'WATS': 'Corgi Funds', 'GLAM': 'Corgi Funds', 'NYNY': 'Corgi Funds',
    'STYL': 'Corgi Funds', 'WNDR': 'Corgi Funds', 'FDRS': 'Corgi Funds',
    'FDRX': 'Corgi Funds',
    # Sprott — actively managed precious metals miners
    'GBUG': 'Sprott',
    # Amplify ETFs — thematic + dividend/income (Firestore feed)
    'BLOK': 'Amplify', 'AIEQ': 'Amplify', 'ETHO': 'Amplify', 'IBUY': 'Amplify',
    'HACK': 'Amplify', 'SILJ': 'Amplify', 'BATT': 'Amplify', 'IPAY': 'Amplify',
    'ITEQ': 'Amplify', 'COWS': 'Amplify', 'DRVR': 'Amplify', 'AWAY': 'Amplify',
    'CNBS': 'Amplify', 'GAMR': 'Amplify', 'DIVO': 'Amplify', 'QDVO': 'Amplify',
    'IDVO': 'Amplify', 'YYY': 'Amplify',
    # Capital Group — actively managed, multi-manager active-equity ETFs
    'CGDV': 'Capital Group', 'CGGR': 'Capital Group', 'CGGO': 'Capital Group',
    'CGUS': 'Capital Group', 'CGXU': 'Capital Group',
    # First Trust — actively managed equity (long/short, market-neutral-adjacent, multi-manager, sub-advised international)
    'FTLS': 'First Trust', 'WCME': 'First Trust', 'WCMG': 'First Trust',
    'WCMI': 'First Trust', 'CRPT': 'First Trust', 'MMSC': 'First Trust',
    'EMLP': 'First Trust',
}

FUND_AUM = {
    'ARKK': 6.8, 'ARKW': 1.8, 'ARKQ': 1.1, 'ARKG': 1.5, 'ARKF': 0.9, 'ARKX': 0.3,
    'AVUV': 12.5, 'AVLV': 3.2, 'AVMV': 0.8,
    # Added 2026-09-03. Third-party estimates — this whole table is known
    # stale (measured up to 14x understated vs summed holdings on 2026-09-03)
    # and feeds convictionScore directly. See docs/REDESIGN-PLAN.md.
    'AVEM': 22.0, 'AVDV': 18.5, 'AVDE': 15.5, 'AVUS': 12.0, 'AVSC': 2.4, 'AVES': 1.3, 'AVIV': 0.7,
    'CHPY': 1.15, 'YMAX': 0.38, 'AMDY': 0.38, 'AMZY': 0.23, 'GOOY': 0.23, 'GDXY': 0.32,
    'KYLD': 0.15, 'KQQQ': 0.1,
    'ULTY': 0.5, 'SLTY': 0.02, 'ULTI': 0.05, 'BLOX': 0.02,
    'EGGQ': 0.06, 'EGGY': 0.02, 'EGGS': 0.02,
    # Weekly pay suite
    'MSTW': 0.05, 'NVDW': 0.04, 'COIW': 0.03, 'TSLW': 0.04, 'HOOW': 0.02, 'PLTW': 0.03,
    'QDTE': 0.3, 'XDTE': 0.2, 'RDTE': 0.1, 'YBTC': 0.1,
    'MSTY': 1.1, 'NVDY': 1.3, 'CONY': 0.4, 'TSLY': 0.9, 'HOOY': 0.05, 'PLTY': 0.05,
    'NVII': 0.04, 'TSII': 0.03,
    # Corgi Funds (launched May 2026, AUM placeholder $50M each)
    'EUV': 0.05, 'CMAG': 0.05, 'CQTM': 0.05, 'XA': 0.05, 'EYES': 0.05,
    'KYC': 0.05, 'GNMX': 0.05, 'AV': 0.05, 'DOCK': 0.05, 'WATS': 0.05,
    'GLAM': 0.05, 'NYNY': 0.05, 'STYL': 0.05, 'WNDR': 0.05, 'FDRS': 0.05,
    'FDRX': 0.05,
    # Sprott
    'GBUG': 0.16,
    # Amplify ETFs (approximate, non-authoritative)
    'BLOK': 1.0, 'AIEQ': 0.1, 'ETHO': 0.15, 'IBUY': 0.25, 'HACK': 0.4,
    'SILJ': 1.2, 'BATT': 0.1, 'IPAY': 0.5, 'ITEQ': 0.15, 'COWS': 0.6,
    'DRVR': 0.15, 'AWAY': 0.2, 'CNBS': 0.05, 'GAMR': 0.05, 'DIVO': 4.0,
    'QDVO': 0.7, 'IDVO': 0.5, 'YYY': 0.4,
    # Capital Group (approximate, non-authoritative)
    'CGDV': 39.0, 'CGGR': 25.0, 'CGGO': 12.0, 'CGUS': 12.0, 'CGXU': 6.8,
    # First Trust (approximate, non-authoritative — real AUM auto-derives from holdings once scraped)
    'FTLS': 3.0, 'WCME': 0.1, 'WCMG': 0.2, 'WCMI': 0.3, 'CRPT': 0.05, 'MMSC': 0.1, 'EMLP': 1.9,
}


# ─── Derived AUM ──────────────────────────────────────────────────────────────
# FUND_AUM above is hand-maintained and badly stale — measured 2026-09-03,
# every sampled entry understated actual AUM, some by up to 14x (AVLV: $3.2B
# static vs $21.6B of actual holdings). It feeds convictionScore directly, so
# a stale table means systematically wrong signal rankings.
#
# get_fund_aum() derives AUM from the latest holdings snapshot instead:
#
#   1. The `NetAssets` column — first non-zero value seen for that fund.
#      Authoritative where present.
#   2. Otherwise the sum of `Market Value` across the fund's rows. Validated
#      against NetAssets on every fund carrying both (2026-09-03): median
#      ratio 1.0000, none outside 0.998-1.000 — a safe proxy.
#   3. Otherwise the static FUND_AUM entry. Kept as the final fallback for a
#      newly added fund that hasn't been scraped yet.
#
# Units are $B, matching FUND_AUM. Mirrors etf-dashboard/lib/holdings.ts's
# getFundAum — keep the two in lockstep (see that file's docstring).
def _derive_fund_aum_map() -> dict[str, float]:
    rows = get_latest_holdings()
    net_assets: dict[str, float] = {}
    mv_sum: dict[str, float] = defaultdict(float)
    funds_seen: set[str] = set()
    for r in rows:
        fund = r.get('ETF Ticker', '')
        if not fund:
            continue
        funds_seen.add(fund)
        if fund not in net_assets:
            na = _safe_float(r.get('NetAssets', '0'))
            if na > 0:
                net_assets[fund] = na
        mv_sum[fund] += _safe_float(r.get('Market Value', '0'))

    derived: dict[str, float] = {}
    for fund in funds_seen | set(FUND_AUM):
        if fund in net_assets:
            derived[fund] = net_assets[fund] / 1e9
        elif mv_sum.get(fund, 0.0) > 0:
            derived[fund] = mv_sum[fund] / 1e9
        else:
            derived[fund] = FUND_AUM.get(fund, 0.0)
    return derived


@functools.lru_cache(maxsize=None)
def _fund_aum_map(as_of_date: str) -> dict[str, float]:
    """Cache key is the data's as-of date, not `self`/args beyond that — the
    map only needs recomputing when the snapshot changes, never per call."""
    return _derive_fund_aum_map()


def get_fund_aum(fund: str) -> float:
    """AUM for `fund` in $B, derived from the latest holdings snapshot.

    See the precedence note above _derive_fund_aum_map. Cached via
    functools.lru_cache keyed on get_as_of_date() so it recomputes only when
    the data date changes, not on every call.
    """
    return _fund_aum_map(get_as_of_date()).get(fund, FUND_AUM.get(fund, 0.0))


# ─── Fund categories ─────────────────────────────────────────────
# Two fundamentally different fund types need different treatment:
#
#   active-equity  — the manager picks stocks. The signal a trader cares
#                    about is conviction over time: what's been accumulated
#                    over a week or a month, what positions were newly
#                    entered, what was fully exited. Daily noise matters less
#                    than the trend. (Avantis, ARK, Corgi Funds, Sprott.)
#
#   option-income  — the fund sells options for yield. Its equity book churns
#                    by design, so day-to-day holdings deltas are not a
#                    "signal" — the option strategy (covered calls / cash-
#                    secured puts, strikes, expiries) is the story.
#                    (Kurv, YieldMax, REX Shares, Roundhill, NestYield,
#                    NicholasX.)
_OPTION_INCOME_PROVIDERS = frozenset({
    'Kurv', 'YieldMax', 'REX Shares', 'Roundhill',
    'Tidal / NestYield', 'Tidal / NicholasX',
})

# Per-fund overrides for providers that ship BOTH product lines, where the
# provider name alone can't decide the category. Amplify is the live case:
# its thematic funds (BLOK, HACK, SILJ ...) are genuine stock-pickers, while
# DIVO/QDVO/IDVO are covered-call income funds — every one of their option
# rows is written (short). Before this override DIVO drove the #1 sell signal
# on the board as an "active-equity" fund.
#
# INVARIANT: any fund holding written option rows must land in 'option-income'.
# tests/test_categories.py asserts this against the latest snapshot, so a new
# overlay fund from a mixed provider fails CI instead of silently polluting
# the equity signals.
_OPTION_INCOME_FUNDS = frozenset({'DIVO', 'QDVO', 'IDVO'})


def get_fund_category(fund: str) -> str:
    """Return 'option-income' or 'active-equity' for a fund ticker.

    Keyed per fund: the provider decides it for single-line shops, with
    _OPTION_INCOME_FUNDS overriding for providers that ship both. Unknown
    funds default to 'active-equity'.
    """
    if fund in _OPTION_INCOME_FUNDS:
        return 'option-income'
    provider = FUND_PROVIDERS.get(fund, '')
    return 'option-income' if provider in _OPTION_INCOME_PROVIDERS else 'active-equity'


def is_institutional_fund(fund: str) -> bool:
    """True if a fund's equity holdings reflect genuine stock-picking conviction.

    Exactly the inverse of the option-income category — there is one definition
    of "income fund" in this codebase and this is it.

    This used to be a NARROWER set (_INCOME_ONLY_PROVIDERS) that kept NicholasX
    (BLOX) and NestYield (EGG*) in the institutional aggregate on the theory
    that their equity books are real stock picks. That produced a split brain:
    those funds were labelled 'option-income' in the UI while being counted as
    stock-pickers in the institutional blend, layering, and stock-detail math —
    which is why EGGQ/EGGY dumping Kroger showed up as the #2 institutional
    sell signal. They write calls against that book; it is collateral, not
    conviction. One rule now, applied everywhere.
    """
    return get_fund_category(fund) == 'active-equity'


def _read_csv(path: str) -> list[dict]:
    """Read a holdings CSV, filter excluded funds, and dedupe to one row
    per (fund, ticker).

    Defensive dedup: some providers (notably the Corgi Funds JSON API) have
    historically returned multi-day time-series in a single snapshot file.
    Without collapsing, /api/v1/ticker/<symbol> ends up showing the same
    fund holding the same ticker N times. We keep the row with the most
    recent `holding_date` if present, otherwise the last row encountered
    (input order). An ETF holding the same ticker more than once at the
    same moment is always a data error, so this is safe to apply globally.
    """
    rows = []
    for r in csv.DictReader(open(path)):
        if r.get('ETF Ticker', '') not in EXCLUDED_FUNDS:
            rows.append(r)

    # Group by (fund, ticker) and keep the freshest row per group.
    seen: dict[tuple[str, str], dict] = {}
    for r in rows:
        key = (r.get('ETF Ticker', ''), r.get('Ticker', ''))
        existing = seen.get(key)
        if existing is None:
            seen[key] = r
            continue
        # Both rows present — pick the one with the later holding_date.
        # Empty / missing dates sort last, so a real date beats nothing.
        if r.get('holding_date', '') > existing.get('holding_date', ''):
            seen[key] = r
    return list(seen.values())


def _safe_float(v: str, default: float = 0.0) -> float:
    try:
        return float(v or '0')
    except (ValueError, TypeError):
        return default


def _nullable_float(v: str | None) -> float | None:
    """Parse a float, or None when the value is blank/missing.

    Distinct from _safe_float's 0.0: for option analytics a real 0 is
    meaningful (a 0-DTE contract, a perfectly at-the-money strike), so a
    missing value must not masquerade as one.
    """
    if v is None or str(v).strip() == '':
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


def get_available_dates() -> list[str]:
    """Return sorted (newest-first) list of *trading-day* dates with history files.

    Non-market-day files (weekend scrapes, holiday runs) are filtered out so that
    streaks and week/month lookbacks count real trading days only.
    """
    files = [f for f in os.listdir(HISTORY_DIR) if f.startswith('holdings_') and f.endswith('.csv')]
    dates = [f.replace('holdings_', '').replace('.csv', '') for f in files]
    return sorted([d for d in dates if _is_trading_day(d)], reverse=True)


def get_as_of_date() -> str:
    dates = get_available_dates()
    return dates[0] if dates else 'unknown'


def get_latest_holdings() -> list[dict]:
    dates = get_available_dates()
    if not dates:
        return []
    return _read_csv(os.path.join(HISTORY_DIR, f'holdings_{dates[0]}.csv'))


def get_previous_holdings() -> list[dict]:
    dates = get_available_dates()
    if len(dates) < 2:
        return []
    return _read_csv(os.path.join(HISTORY_DIR, f'holdings_{dates[1]}.csv'))


def _parse_iso(s: str) -> date | None:
    """Parse a 'YYYY-MM-DD' history-file date; None if it can't be parsed."""
    try:
        return date.fromisoformat(s)
    except (ValueError, TypeError):
        return None


def _snapshot_for_lookback(days_back: int) -> list[dict]:
    """
    Holdings rows from the snapshot closest to `days_back` CALENDAR days
    before the latest snapshot.

    History files land on an irregular cadence — weekends are occasionally
    present, market holidays leave gaps — so counting files ("5 files ago")
    drifts away from the intended window. We instead pick the newest snapshot
    whose date is on or before (latest - days_back), and fall back to the
    oldest snapshot we have when history doesn't reach back that far.
    """
    dates = get_available_dates()  # ISO strings, newest-first
    if len(dates) < 2:
        return []
    latest = _parse_iso(dates[0])
    if latest is None:
        # Unparseable filename date — degrade gracefully to index-based lookup
        # (~5 trading days per 7 calendar days).
        idx = min(max(1, round(days_back * 5 / 7)), len(dates) - 1)
        return _read_csv(os.path.join(HISTORY_DIR, f'holdings_{dates[idx]}.csv'))
    target = latest - timedelta(days=days_back)
    chosen = None
    for d in dates[1:]:  # skip the latest snapshot itself
        pd = _parse_iso(d)
        if pd is not None and pd <= target:
            chosen = d
            break
    if chosen is None:
        chosen = dates[-1]  # not enough history — use the oldest snapshot we have
    return _read_csv(os.path.join(HISTORY_DIR, f'holdings_{chosen}.csv'))


def _row_price(r: dict) -> float:
    """Per-unit price for a holding row.

    The providers' `Price` column is populated on <10% of rows, but `Market
    Value` and `Share Quantity` are present on essentially all of them, so we
    derive price from those and fall back to the explicit column. Returns 0.0
    when neither is usable — callers treat that as "price unknown" and assume
    no drift rather than inventing a return.
    """
    shares = _safe_float(r.get('Share Quantity', '0'))
    mv = _safe_float(r.get('Market Value', '0'))
    if shares and mv:
        return mv / shares
    return _safe_float(r.get('Price', '0'))


def _build_map(rows: list[dict]) -> dict:
    m = {}
    for r in rows:
        raw_ticker = _clean_ticker(r.get('Ticker', ''))
        key = (r.get('ETF Ticker', ''), raw_ticker)
        m[key] = {
            'fund': r.get('ETF Ticker', ''),
            'ticker': raw_ticker,
            'name': r.get('Name', ''),
            'sector': r.get('Sector', '') or _SECTOR_FALLBACK.get(raw_ticker, ''),
            'weight': _safe_float(r.get('Weight', '0')),
            'shares': _safe_float(r.get('Share Quantity', '0')),
            'price': _row_price(r),
            'option_type': r.get('Option_Type', ''),
            'underlying': r.get('Underlying_Ticker', ''),
            'strike': r.get('Option_Strike', ''),
            'expiry': r.get('Option_Expiry', ''),
        }
    return m


# Share ratios a corporate action can plausibly produce. A split multiplies
# shares by k and divides price by k, leaving the position's VALUE untouched —
# which is exactly how we tell it apart from a trade.
_SPLIT_FACTORS = (1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 10.0, 20.0)
_SPLIT_FACTORS = _SPLIT_FACTORS + tuple(1.0 / k for k in _SPLIT_FACTORS)


def _split_factor(prev_shares: float, curr_shares: float,
                  prev_price: float, curr_price: float) -> float:
    """Detect a stock split / reverse split between two snapshots. 1.0 = none.

    WHY THIS IS LOAD-BEARING
    ------------------------
    CrowdStrike split 4:1 between 2026-07-01 and 07-02. Share count went
    4,395 -> 17,580 and the price quartered; the position's weight barely moved
    (3.560% -> 3.547%). To a naive drift model that looks like a 75% price
    collapse the manager leaned into by quadrupling the position: it produced a
    phantom +2.64pp "active buy". Worse, because active weight is zero-sum
    within a fund, that phantom pushed all 54 untouched FDRS holdings negative
    and manufactured 34 false sell signals from a single corporate action.

    A split preserves value: shares_ratio * price_ratio ~= 1. A real trade does
    not — buying more of something costs money and moves the position's value.
    We additionally require the share ratio to sit within 2% of a recognizable
    split factor, so a manager who happens to add 35% into a 26% drawdown is
    not mistaken for a corporate action.
    """
    if prev_shares <= 0 or curr_shares <= 0 or prev_price <= 0 or curr_price <= 0:
        return 1.0
    share_ratio = curr_shares / prev_shares
    price_ratio = curr_price / prev_price
    for k in _SPLIT_FACTORS:
        if abs(share_ratio / k - 1.0) < 0.02 and abs(price_ratio * k - 1.0) < 0.15:
            return k
    return 1.0


def _active_weight_deltas(curr: dict, prev: dict) -> dict[tuple[str, str], float]:
    """Weight change attributable to the MANAGER, with price drift removed.

    WHY RAW WEIGHT IS NOT A SIGNAL
    ------------------------------
    A holding's weight moves when its price moves, even if nobody trades a
    single share. Measured against the live board, raw `weightDelta` agreed
    with the fund's actual share change only ~49% of the time — a coin flip —
    and ~55% of all "signals" came from rows where zero shares changed hands.
    ARKK was shown as the top *buyer* of AMD on a day it sold 6,338 shares.

    WHY RAW SHARES ARE NOT A SIGNAL EITHER
    -------------------------------------
    Share counts move on creation/redemption. When EGGY issued +2.63% creation
    units, all 19 of its equity positions gained exactly +2.63% shares because
    the inflow was deployed pro-rata. The manager expressed no view whatsoever;
    a shares-based metric would report nineteen fresh buys.

    THE MEASURE
    -----------
    Compare each holding's actual weight to the weight it *would* have had if
    the manager never traded and only prices moved (the buy-and-hold drift):

        drift_i = w_prev_i * (p_curr_i / p_prev_i) / Σ_j [w_prev_j * ratio_j]
        active_i = w_curr_i - drift_i

    Because the drift weights are renormalized to the previous snapshot's total,
    this cancels price moves AND fund flows in one step: a pro-rata inflow
    leaves every weight unchanged, so every `active_i` is ~0. It is a zero-sum
    reallocation — Σ active_i ≈ 0 — which is exactly what "the manager moved
    money from here to there" should look like.

    Options and money-market rows are deliberately INCLUDED in the denominator:
    weights sum to 100 across the whole book, so excluding a sleeve would skew
    the renormalization for every equity in the fund.

    Positions absent from `prev` are entirely active (a brand-new position is
    100% a decision). Positions absent from `curr` drift to their would-be
    weight and are then fully unwound.

    Keys whose fund cannot be normalized (no usable previous weights) are
    omitted; callers fall back to the raw delta for those.
    """
    prev_by_fund: dict[str, list] = defaultdict(list)
    for key in prev:
        prev_by_fund[key[0]].append(key)

    active: dict[tuple[str, str], float] = {}
    for _fund, keys in prev_by_fund.items():
        prev_sum = sum(prev[k]['weight'] for k in keys)
        if prev_sum <= 0:
            continue  # nothing to renormalize against — caller uses raw delta
        ratios: dict[tuple[str, str], float] = {}
        denom = 0.0
        for k in keys:
            p = prev[k]
            c = curr.get(k)
            # Price unknown on either side (or a REMOVED row with no current
            # price) => assume no drift rather than fabricate a return.
            ratio = 1.0
            if c is not None and p['price'] > 0 and c['price'] > 0:
                # An untouched position through a k:1 split is worth
                # (k * shares) * (price / k) — so its value grows by
                # k * price_ratio, not price_ratio. Without this the split
                # reads as a massive discretionary buy.
                split = _split_factor(p['shares'], c['shares'], p['price'], c['price'])
                ratio = (c['price'] / p['price']) * split
            ratios[k] = ratio
            denom += p['weight'] * ratio
        if denom <= 0:
            continue
        for k in keys:
            drift = prev[k]['weight'] * ratios[k] / denom * prev_sum
            curr_weight = curr[k]['weight'] if k in curr else 0.0
            active[k] = curr_weight - drift

    # A position with no previous snapshot has no drift to subtract — all of it
    # is a decision the manager made today.
    for key, c in curr.items():
        if key not in prev:
            active[key] = c['weight']
    return active


def _changes_between(curr_rows: list[dict], prev_rows: list[dict], *, include_options: bool = False) -> list[dict]:
    """
    Compute change records between two holdings snapshots.

    By default options are excluded (matches existing /api/v1/changes contract).
    Pass include_options=True to get a richer payload with `isOption` and
    `optionDetails` — used by /api/v1/activity and /api/v1/briefing.

    Every record carries both `weightDelta` (raw, price-contaminated, kept for
    backwards compatibility) and `activeWeightDelta` (price-drift removed —
    see `_active_weight_deltas`). Direction and conviction downstream key off
    the active figure; the raw one is retained so existing consumers and the
    fund-level "how did this position's weight actually move" view still work.
    """
    curr = _build_map(curr_rows)
    prev = _build_map(prev_rows)
    # Computed over the FULL maps (options + cash included) before any junk or
    # option filtering, so the per-fund renormalization sees the whole book.
    active = _active_weight_deltas(curr, prev)
    changes: list[dict] = []

    def _record(c: dict, kind: str, weight_delta: float, shares_delta: float,
                active_delta: float, prev_weight: float = 0.0,
                prev_shares: float = 0.0) -> dict:
        is_option = bool(c.get('option_type'))
        rec: dict = {
            'fund': c['fund'],
            'ticker': c['ticker'],
            'name': c['name'],
            'sector': c['sector'],
            'weightDelta': round(weight_delta, 4),
            'activeWeightDelta': round(active_delta, 4),
            'sharesDelta': round(shares_delta, 2),
            'currentWeight': round(c['weight'], 4),
            'previousWeight': round(prev_weight, 4),
            'currentShares': round(c['shares'], 2),
            'previousShares': round(prev_shares, 2),
            'type': kind,
            'isOption': is_option,
            'fundCategory': get_fund_category(c['fund']),
        }
        if include_options and is_option:
            rec['optionDetails'] = {
                'type': c.get('option_type', ''),
                'strike': _safe_float(c.get('strike', '0')),
                'expiry': c.get('expiry', ''),
                'underlying': c.get('underlying', ''),
            }
        return rec

    for key, c in curr.items():
        if c['option_type']:
            if not include_options:
                continue
            # Option tickers (e.g. "NVDA  260522C00200000") are deliberately
            # "junk-shaped" — they must skip the equity junk-ticker filter,
            # which otherwise drops every option row even when include_options.
        elif _is_junk_ticker(c['ticker']):
            continue
        p = prev.get(key)
        if p:
            wd = c['weight'] - p['weight']
            sd = c['shares'] - p['shares']
            if abs(wd) > 0.0001 or abs(sd) > 0:
                rec = _record(c, 'CHANGED', wd, sd, active.get(key, wd),
                              prev_weight=p['weight'], prev_shares=p['shares'])
                # A 4:1 split shows sharesDelta=+13,185 while nothing was
                # bought. Flag it so consumers don't read the raw share move as
                # a purchase; activeWeightDelta already accounts for it.
                split = _split_factor(p['shares'], c['shares'], p['price'], c['price'])
                if split != 1.0:
                    rec['splitFactor'] = round(split, 4)
                changes.append(rec)
        elif c['weight'] > 0 or (c['option_type'] and (c['weight'] != 0 or c['shares'] != 0)):
            # Equities count as NEW only with positive weight; an option can be
            # written (negative weight), so any non-zero position counts.
            changes.append(_record(c, 'NEW', c['weight'], c['shares'],
                                   active.get(key, c['weight'])))

    for key, p in prev.items():
        if p['option_type']:
            if not include_options:
                continue
        elif _is_junk_ticker(p['ticker']):
            continue
        if key in curr:
            continue
        # The "removed" record uses the previous snapshot's fields
        c_like = {**p, 'weight': 0.0, 'shares': 0.0}
        changes.append(_record(c_like, 'REMOVED', -p['weight'], -p['shares'],
                               active.get(key, -p['weight']),
                               prev_weight=p['weight'], prev_shares=p['shares']))

    changes.sort(key=lambda x: -abs(x['activeWeightDelta']))
    return changes


def compute_daily_changes() -> list[dict]:
    """Compute all changes between the two most recent days (equities only)."""
    return _changes_between(get_latest_holdings(), get_previous_holdings(), include_options=False)


def compute_daily_changes_with_options() -> list[dict]:
    """Daily changes including option rows, with optionDetails attached."""
    return _changes_between(get_latest_holdings(), get_previous_holdings(), include_options=True)


def compute_weekly_changes(*, include_options: bool = False) -> list[dict]:
    """Changes between today and the snapshot closest to 7 calendar days ago.

    A position present today but absent a week ago surfaces as a NEW change;
    one present a week ago but gone today surfaces as REMOVED — that's the
    week-over-week "entered / exited a position" view.
    """
    older = _snapshot_for_lookback(7)
    if not older:
        return []
    return _changes_between(get_latest_holdings(), older, include_options=include_options)


def compute_monthly_changes(*, include_options: bool = False) -> list[dict]:
    """Changes between today and the snapshot closest to 30 calendar days ago.

    Same NEW / REMOVED semantics as compute_weekly_changes, over a month —
    the right horizon for slower-moving active-equity funds (Avantis, ARK).
    """
    older = _snapshot_for_lookback(30)
    if not older:
        return []
    return _changes_between(get_latest_holdings(), older, include_options=include_options)


def _blend_institutional(rows: list[dict], total_aum: float) -> tuple[dict, dict, dict, dict]:
    """AUM-weighted blended portfolio weight per underlying ticker.

    Treats every institutional fund as one combined portfolio of size
    `total_aum` ($B). A ticker's blended weight is the sum over funds of
    (fund weight in % × fund AUM) / total_aum — i.e. the percentage of the
    combined institutional book sitting in that ticker. Options rows, junk
    tickers, income-only funds, and funds with no AUM figure are skipped.

    Returns (blended_weight, name, sector, funds_holding) keyed by ticker.
    """
    weight: dict[str, float] = defaultdict(float)
    name: dict[str, str] = {}
    sector: dict[str, str] = {}
    funds: dict[str, set] = defaultdict(set)
    for r in rows:
        if r.get('Option_Type'):
            continue
        fund = r.get('ETF Ticker', '')
        if not is_institutional_fund(fund):
            continue
        aum = get_fund_aum(fund)
        if aum <= 0:
            continue
        ticker = _clean_ticker(r.get('Ticker', ''))
        if _is_junk_ticker(ticker):
            continue
        weight[ticker] += _safe_float(r.get('Weight', '0')) * aum / total_aum
        name.setdefault(ticker, r.get('Name', ''))
        if not sector.get(ticker):
            sector[ticker] = r.get('Sector', '') or _SECTOR_FALLBACK.get(ticker, '')
        funds[ticker].add(fund)
    return weight, name, sector, funds


def compute_institutional_flow(period: str = 'daily', limit: int = 25) -> dict:
    """Cross-fund 'institutions as a whole' flow over a daily/weekly/monthly window.

    Blends every stock-picking fund (income funds excluded) into one
    AUM-weighted portfolio and reports how the combined weight of each ticker
    shifted over the window — the net buying/selling of institutions in
    aggregate. Positive weightDelta = the combined book grew its position.
    """
    latest = get_latest_holdings()
    if period == 'weekly':
        older = _snapshot_for_lookback(7)
    elif period == 'monthly':
        older = _snapshot_for_lookback(30)
    else:
        period = 'daily'
        older = get_previous_holdings()

    empty = {'period': period, 'asOfDate': get_as_of_date(),
             'fundCount': 0, 'totalAum': 0.0, 'buying': [], 'selling': []}
    if not latest or not older:
        return empty

    # Fixed denominator across both snapshots: the AUM of institutional funds
    # present today. Using one constant keeps the day-vs-window delta apples-to-
    # apples — a fund absent from the older snapshot simply contributes 0 then,
    # which correctly surfaces a freshly built position.
    inst_funds = {r.get('ETF Ticker', '') for r in latest
                  if is_institutional_fund(r.get('ETF Ticker', ''))}
    total_aum = sum(get_fund_aum(f) for f in inst_funds)
    if total_aum <= 0:
        return empty

    new_w, name, sector, funds_now = _blend_institutional(latest, total_aum)
    old_w, _, _, _ = _blend_institutional(older, total_aum)

    rows: list[dict] = []
    for ticker in set(new_w) | set(old_w):
        delta = new_w.get(ticker, 0.0) - old_w.get(ticker, 0.0)
        if round(delta, 4) == 0:
            continue
        rows.append({
            'ticker': ticker,
            'name': name.get(ticker, ''),
            'sector': sector.get(ticker, ''),
            'blendedWeight': round(new_w.get(ticker, 0.0), 4),
            'previousBlendedWeight': round(old_w.get(ticker, 0.0), 4),
            'weightDelta': round(delta, 4),
            'fundCount': len(funds_now.get(ticker, set())),
            'funds': sorted(funds_now.get(ticker, set())),
            'direction': 'buying' if delta > 0 else 'selling',
        })

    buying = sorted([r for r in rows if r['weightDelta'] > 0],
                    key=lambda x: -x['weightDelta'])[:limit]
    selling = sorted([r for r in rows if r['weightDelta'] < 0],
                     key=lambda x: x['weightDelta'])[:limit]
    return {
        'period': period,
        'asOfDate': get_as_of_date(),
        'fundCount': len(inst_funds),
        'totalAum': round(total_aum, 2),
        'buying': buying,
        'selling': selling,
    }


def _trend_signal(monthly: float, weekly: float, daily: float) -> str:
    """Classify an accumulation/distribution trajectory from the dominant
    (monthly) trend versus the most recent (daily) move.

      accumulating          monthly up, still buying today
      distribution-starting monthly up but selling today — the topping signal
      distributing          monthly down, still selling today
      bottoming             monthly down but buying today
    """
    if monthly >= 0:
        return 'accumulating' if daily >= 0 else 'distribution-starting'
    return 'distributing' if daily <= 0 else 'bottoming'


def compute_institutional_trend(limit: int = 15) -> dict:
    """Per-ticker institutional flow across all three horizons at once.

    Blends every stock-picking fund into one AUM-weighted book (income funds
    excluded — see is_institutional_fund) and, for each ticker, reports the
    change in its blended weight over the day, week, and month using ONE fixed
    denominator (today's institutional AUM) so the three are directly
    comparable and can be overlaid. Ranked by the monthly move — the dominant
    trend — so sustained accumulation and fresh distribution both surface.
    """
    latest = get_latest_holdings()
    mo = _snapshot_for_lookback(30)
    empty = {'asOfDate': get_as_of_date(), 'fundCount': 0, 'tickers': []}
    if not latest or not mo:
        return empty

    inst_funds = {r.get('ETF Ticker', '') for r in latest
                  if is_institutional_fund(r.get('ETF Ticker', ''))}
    total_aum = sum(get_fund_aum(f) for f in inst_funds)
    if total_aum <= 0:
        return empty

    cur_w, name, sector, funds_now = _blend_institutional(latest, total_aum)
    prev = get_previous_holdings()
    wk = _snapshot_for_lookback(7)
    prev_w = _blend_institutional(prev, total_aum)[0] if prev else {}
    wk_w = _blend_institutional(wk, total_aum)[0] if wk else {}
    mo_w = _blend_institutional(mo, total_aum)[0]

    rows = []
    for t in set(cur_w) | set(mo_w):
        cur = cur_w.get(t, 0.0)
        daily = cur - prev_w.get(t, 0.0)
        weekly = cur - wk_w.get(t, 0.0)
        monthly = cur - mo_w.get(t, 0.0)
        if round(monthly, 4) == 0 and round(weekly, 4) == 0 and round(daily, 4) == 0:
            continue
        rows.append({
            'ticker': t,
            'name': name.get(t, ''),
            'sector': sector.get(t, ''),
            'blendedWeight': round(cur, 4),
            'daily': round(daily, 4),
            'weekly': round(weekly, 4),
            'monthly': round(monthly, 4),
            'fundCount': len(funds_now.get(t, set())),
            'signal': _trend_signal(monthly, weekly, daily),
        })

    rows.sort(key=lambda x: -abs(x['monthly']))
    return {
        'asOfDate': get_as_of_date(),
        'fundCount': len(inst_funds),
        'tickers': rows[:limit],
    }


def get_global_stats(changes: list[dict] | None = None) -> dict:
    latest = get_latest_holdings()
    funds = set()
    tickers = set()
    options = 0
    puts = 0
    calls = 0

    for r in latest:
        funds.add(r.get('ETF Ticker', ''))
        if r.get('Option_Type', ''):
            options += 1
            if r.get('Option_Type', '') == 'Put':
                puts += 1
            elif r.get('Option_Type', '') == 'Call':
                calls += 1
        else:
            tickers.add(r.get('Ticker', ''))

    # Count brand-new equity positions opened today. Accepts a pre-computed
    # changes list (from get_full_payload) to avoid a second CSV pass; falls
    # back to computing fresh when called standalone (e.g. /api/v1/stats).
    if changes is None:
        changes = compute_daily_changes()
    new_positions_today = sum(
        1 for c in changes
        if c.get('type') == 'NEW' and not c.get('isOption')
    )
    exits_today = sum(
        1 for c in changes
        if c.get('type') == 'REMOVED' and not c.get('isOption')
    )

    return {
        'asOfDate': get_as_of_date(),
        'fundsTracked': len(funds),
        'uniqueTickers': len(tickers),
        'optionsContracts': options,
        'putCallRatio': round(puts / calls, 2) if calls > 0 else 0,
        'newPositionsToday': new_positions_today,
        'exitsToday': exits_today,
    }


FundCategory = str  # 'active-equity' | 'option-income'


def _filter_by_category(changes: list[dict], category: str | None) -> list[dict]:
    """Restrict change records to one fund category. None means all.

    MUST be applied AFTER _changes_between returns, never to the rows going in:
    _active_weight_deltas is zero-sum within a fund and renormalizes over the
    whole book, so pre-filtering would corrupt the denominator for every
    position that survives.
    """
    if not category:
        return changes
    return [c for c in changes if c.get('fundCategory') == category]


def _filter_streaks_by_category(streaks: dict[tuple[str, str], int],
                                category: str | None) -> dict[tuple[str, str], int]:
    """Streaks are keyed (fund, ticker), so category filtering is by key[0]."""
    if not category:
        return streaks
    return {k: v for k, v in streaks.items() if get_fund_category(k[0]) == category}


def _compute_streaks(max_days: int = 10) -> dict[tuple[str, str], int]:
    """
    Read up to `max_days` of history files and compute consecutive-day
    streaks per (fund, ticker). Positive = accumulating, negative = reducing.
    Only streaks of magnitude >= 2 are returned.

    Mirrors getStreaks() from holdings.ts (review #10).

    Each day's step is an `activeWeightDelta`, not a raw weight change. On raw
    weight a stock that simply rallied five sessions running reads as a
    five-day accumulation streak by every fund holding it — the streak measured
    the price chart, not the manager.
    """
    dates = get_available_dates()
    if len(dates) < 2:
        return {}

    snapshots: list[dict[tuple[str, str], dict]] = []
    for d in dates[:max_days]:
        rows = _read_csv(os.path.join(HISTORY_DIR, f'holdings_{d}.csv'))
        snapshots.append(_build_map(rows))

    # pair_active[i] = drift-adjusted move from snapshots[i] (older) into
    # snapshots[i-1] (newer). Index 0 is unused; days are newest-first.
    pair_active: list[dict | None] = [None]
    for i in range(1, len(snapshots)):
        pair_active.append(_active_weight_deltas(snapshots[i - 1], snapshots[i]))

    streaks: dict[tuple[str, str], int] = {}
    newest = snapshots[0]
    for key, curr in newest.items():
        if curr['option_type']:
            continue
        streak = 0
        for i in range(1, len(snapshots)):
            prev = snapshots[i].get(key)
            if prev is None:
                if streak == 0:
                    streak = 1
                break
            raw_delta = snapshots[i - 1].get(key, {}).get('weight', 0.0) - prev['weight']
            day_delta = (pair_active[i] or {}).get(key, raw_delta)
            if day_delta > 0.001:
                if streak >= 0:
                    streak += 1
                else:
                    break
            elif day_delta < -0.001:
                if streak <= 0:
                    streak -= 1
                else:
                    break
            else:
                break
        if abs(streak) >= 2:
            streaks[key] = streak
    return streaks


def _signals_from(changes: list[dict], streaks: dict[tuple[str, str], int] | None = None) -> dict:
    """
    Compute top buying/selling signals from a precomputed changes list.

    Enriched in review #10 finale: now includes per-fund details, fundCount,
    providerCount, totalWeightDelta, convictionScore, and streak — matching
    what the dashboard's holdings.ts produced. Original fields (ticker, name,
    weightDelta, funds, providers, conviction, direction) are retained for
    backwards-compat with existing API consumers.

    Direction, significance, and conviction are all driven by
    `activeWeightDelta` (price drift removed) rather than raw weight — a stock
    whose weight rose purely because it rallied is not a fund buying it. The
    signal's `weightDelta` therefore reports the ACTIVE total, so its sign
    always agrees with `direction`; the price-inclusive sum is preserved
    alongside as `rawWeightDelta`.
    """
    if streaks is None:
        streaks = {}

    # Group equity changes by ticker (options live in their own bucket)
    by_ticker: dict[str, dict] = defaultdict(lambda: {
        'name': '', 'sector': '',
        'fundDetails': [],  # list of {fund, weightDelta, currentWeight, type}
    })
    for c in changes:
        if c.get('isOption') or _is_junk_ticker(c['ticker']):
            continue
        # Significance filter — small moves don't count
        threshold = _significance_threshold(c['fund'])
        if abs(c['activeWeightDelta']) < threshold:
            continue
        entry = by_ticker[c['ticker']]
        entry['name'] = c['name'] or entry['name']
        entry['sector'] = c['sector'] or entry['sector']
        entry['fundDetails'].append({
            'fund': c['fund'],
            'weightDelta': c['activeWeightDelta'],
            'rawWeightDelta': c['weightDelta'],
            'activeWeightDelta': c['activeWeightDelta'],
            'sharesDelta': c.get('sharesDelta', 0.0),
            'currentWeight': c.get('currentWeight', 0.0),
            'type': c['type'],
            # $B, from get_fund_aum() — lets consumers (dashboard/equity page
            # dollar-exposure estimates) read AUM straight off the signal
            # instead of re-deriving it client-side.
            'aum': get_fund_aum(c['fund']),
        })

    signals: list[dict] = []
    for ticker, v in by_ticker.items():
        for direction_label, direction_filter in (('buying', lambda f: f['activeWeightDelta'] > 0),
                                                   ('selling', lambda f: f['activeWeightDelta'] < 0)):
            side_funds = [f for f in v['fundDetails'] if direction_filter(f)]
            if not side_funds:
                continue
            total_wd = sum(f['activeWeightDelta'] for f in side_funds)
            total_raw_wd = sum(f['rawWeightDelta'] for f in side_funds)
            providers = sorted({FUND_PROVIDERS.get(f['fund'], f['fund']) for f in side_funds})
            aum_total = sum(get_fund_aum(f['fund']) or 0.01 for f in side_funds)
            avg_aum = aum_total / len(side_funds)
            # Streak — max abs streak across funds in this signal
            streak = 0
            for f in side_funds:
                s = streaks.get((f['fund'], ticker), 0)
                if abs(s) > abs(streak):
                    streak = s

            signals.append({
                'ticker': ticker,
                'name': v['name'],
                'sector': v['sector'],
                # Backwards-compatible fields (now drift-adjusted, so the sign
                # always matches `direction`):
                'weightDelta': round(total_wd, 4),
                'funds': [f['fund'] for f in side_funds],
                'providers': providers,
                'conviction': round(abs(total_wd) * aum_total * (1.5 if len(providers) > 1 else 1), 3),
                'direction': direction_label,
                # Enriched fields (review #10):
                'fundDetails': side_funds,
                'fundCount': len(side_funds),
                'providerCount': len(providers),
                'totalWeightDelta': round(total_wd, 4),
                # The price-inclusive move, for anyone who wants to see how much
                # of the weight change was the market rather than the manager.
                'rawWeightDelta': round(total_raw_wd, 4),
                'avgWeightDelta': round(total_wd / len(side_funds), 4),
                'convictionScore': round(len(side_funds) * abs(total_wd) * avg_aum, 4),
                'streak': abs(streak) if abs(streak) >= 2 else None,
            })

    # Two sort modes coexist:
    # - 'conviction' (legacy) is what the existing API consumer sees
    # - 'convictionScore' (new, dashboard-shaped) is the additive richer score
    # We sort by convictionScore since that's what the dashboard uses.
    signals.sort(key=lambda x: -x['convictionScore'])
    return {
        'buying': [s for s in signals if s['direction'] == 'buying'][:10],
        'selling': [s for s in signals if s['direction'] == 'selling'][:10],
    }


def _activity_from(changes: list[dict]) -> dict:
    """
    Bucket changes into accumulating / reducing / optionsActivity, applying
    the per-fund significance threshold. Mirrors getBuyingSelling() from
    holdings.ts.

    "Accumulating" and "reducing" mean the manager traded, so the split is on
    `activeWeightDelta` — a position that merely appreciated is not being
    accumulated. Option rows keep the raw ordering: an option's weight moves
    with its premium, and the drift model (built for equity share counts)
    doesn't describe that meaningfully.
    """
    accumulating: list[dict] = []
    reducing: list[dict] = []
    options_activity: list[dict] = []
    for r in changes:
        if _is_junk_ticker(r['ticker']):
            continue
        if r.get('isOption'):
            options_activity.append(r)
            continue
        if abs(r['activeWeightDelta']) < _significance_threshold(r['fund']):
            continue
        (accumulating if r['activeWeightDelta'] > 0 else reducing).append(r)

    accumulating.sort(key=lambda r: -r['activeWeightDelta'])
    reducing.sort(key=lambda r: r['activeWeightDelta'])
    options_activity.sort(key=lambda r: -abs(r['weightDelta']))
    return {
        'accumulating': accumulating,
        'reducing': reducing,
        'optionsActivity': options_activity,
    }


def _decode_option_signal(record: dict) -> dict | None:
    """Translate a covered call or cash-secured put record into plain English."""
    if not record.get('isOption') or 'optionDetails' not in record:
        return None
    opt = record['optionDetails']
    type_str = (opt.get('type') or '').lower()
    strike = opt.get('strike', 0)
    moneyness = 'OTM (likely)' if record.get('currentWeight', 0) > 0 else 'ATM/ITM'
    if type_str.startswith('p'):
        return {
            'strategy': 'Cash-Secured Put',
            'directionalView': f'Bullish above ${strike}',
            'moneyness': moneyness,
        }
    if type_str.startswith('c'):
        return {
            'strategy': 'Covered Call',
            'directionalView': f'Capping upside at ${strike}',
            'moneyness': moneyness,
        }
    return None


def _briefing_from(
    signals: dict,
    activity: dict,
    streaks: dict[tuple[str, str], int],
) -> dict:
    """
    Pre-market briefing: top buys/sells, multi-provider convergence, active
    streaks, notable new options. Mirrors getPreMarketBriefing() from
    holdings.ts.
    """
    buying = signals.get('buying', [])
    selling = signals.get('selling', [])

    cross_fund = sorted(
        [s for s in buying + selling if s.get('providerCount', 0) >= 2],
        key=lambda s: -s.get('convictionScore', 0),
    )[:5]

    notable_options: list[dict] = []
    for r in activity.get('optionsActivity', [])[:5]:
        if r.get('type') != 'NEW':
            continue
        sig = _decode_option_signal(r)
        if sig:
            notable_options.append({'record': r, 'signal': sig})

    active_streaks = [
        {
            'fund': fund,
            'ticker': ticker,
            'days': abs(days),
            'direction': 'up' if days > 0 else 'down',
        }
        for (fund, ticker), days in streaks.items()
        if abs(days) >= 3
    ]
    active_streaks.sort(key=lambda s: -s['days'])

    return {
        'topBuys': buying[:3],
        'topSells': selling[:3],
        'crossFundConvergence': cross_fund,
        'activeStreaks': active_streaks[:10],
        'notableOptions': notable_options,
    }


def _sector_flow_from(changes: list[dict]) -> dict:
    """Compute sector flow from a precomputed changes list.

    Keys off activeWeightDelta, not raw weightDelta — a sector's weight moves
    when its constituents' prices move, even if nobody traded. This mirrors
    getSectorFlow() in etf-dashboard/lib/holdings.ts, which has always summed
    the active delta; the Python side had drifted to raw weight and was the
    one the dashboard actually rendered.
    """
    sectors: dict[str, float] = defaultdict(float)
    for c in changes:
        if c['sector'] and not _is_junk_ticker(c['ticker']):
            sectors[c['sector']] += c['activeWeightDelta']

    inflows: list[dict] = []
    outflows: list[dict] = []
    for sector, delta in sorted(sectors.items(), key=lambda x: -abs(x[1])):
        if abs(delta) < 0.001:
            continue
        entry = {'sector': sector, 'delta': round(delta, 4)}
        (inflows if delta > 0 else outflows).append(entry)
    return {'inflows': inflows, 'outflows': outflows}


def _divergences_from(changes: list[dict]) -> list[dict]:
    """
    Compute divergences from a precomputed changes list.

    Enriched in review #10: applies the per-fund significance threshold, adds
    name + provider + per-fund weightDelta, and flags `intrashop` when buying
    and selling funds share a provider. The original simple shape (`buying` /
    `selling` as plain fund-name lists) is kept for backwards compat.

    Buy/sell classification uses `activeWeightDelta`. Raw weight actively
    *hides* divergences: a ticker's price move pushes its weight the same
    direction in every fund holding it, so two managers genuinely trading
    against each other can both look like buyers on a green day.
    """
    grouped: dict[str, dict] = defaultdict(lambda: {
        'name': '',
        'buyingFunds': [],
        'sellingFunds': [],
    })
    for c in changes:
        if c.get('isOption') or _is_junk_ticker(c['ticker']):
            continue
        if abs(c['activeWeightDelta']) < _significance_threshold(c['fund']):
            continue
        entry = grouped[c['ticker']]
        entry['name'] = c['name'] or entry['name']
        record = {
            'fund': c['fund'],
            'provider': FUND_PROVIDERS.get(c['fund'], c['fund']),
            'category': c.get('fundCategory', get_fund_category(c['fund'])),
            'weightDelta': c['activeWeightDelta'],
            'rawWeightDelta': c['weightDelta'],
        }
        (entry['buyingFunds'] if c['activeWeightDelta'] > 0 else entry['sellingFunds']).append(record)

    divs: list[dict] = []
    for ticker, d in grouped.items():
        if not d['buyingFunds'] or not d['sellingFunds']:
            continue
        buying_providers = {f['provider'] for f in d['buyingFunds']}
        selling_providers = {f['provider'] for f in d['sellingFunds']}
        intrashop = bool(buying_providers & selling_providers)
        # A "disagreement" between a stock-picker and an option-overlay fund is
        # not a disagreement — one made a call on the company, the other needed
        # something to write contracts against. Flagged rather than dropped so
        # the UI can demote it and an unfiltered API caller still sees it.
        categories = {f['category'] for f in d['buyingFunds'] + d['sellingFunds']}
        divs.append({
            'ticker': ticker,
            'name': d['name'],
            # Backwards-compat plain lists:
            'buying': [f['fund'] for f in d['buyingFunds']],
            'selling': [f['fund'] for f in d['sellingFunds']],
            # Enriched fields:
            'buyingFunds': d['buyingFunds'],
            'sellingFunds': d['sellingFunds'],
            'intrashop': intrashop,
            'crossCategory': len(categories) > 1,
        })

    # Sort: real intra-shop conflicts first, then by total conflict magnitude.
    # crossCategory ones sink — they were auto-expanding the dashboard card.
    def _magnitude(d: dict) -> float:
        return sum(abs(f['weightDelta']) for f in d['buyingFunds'] + d['sellingFunds'])

    divs.sort(key=lambda d: (d['crossCategory'], not d['intrashop'], -_magnitude(d)))
    return divs


# ─── Public wrappers (each still callable standalone) ──────────────
def get_signals(*, category: str | None = None) -> dict:
    """Top buying/selling signals with conviction scores.

    `category` restricts to 'active-equity' or 'option-income'; None (the
    default) keeps every fund, so existing callers are unaffected.

    Conviction on an option-income fund is not conviction — its equity book is
    collateral for the overlay and churns by design — so the equity world
    passes 'active-equity' here rather than filtering the result afterwards.
    Filtering afterwards would leave convictionScore and totalWeightDelta
    computed over the mixed universe and therefore wrong.
    """
    changes = _filter_by_category(compute_daily_changes(), category)
    streaks = _filter_streaks_by_category(_compute_streaks(), category)
    return _signals_from(changes, streaks)


def get_sector_flow(*, category: str | None = None) -> dict:
    """Sector-level weight changes."""
    return _sector_flow_from(_filter_by_category(compute_daily_changes(), category))


def get_divergences(*, category: str | None = None) -> list[dict]:
    """Cross-fund divergences: same ticker, opposite directions."""
    return _divergences_from(_filter_by_category(compute_daily_changes(), category))


def compute_layering_patterns(window_days: int = 5, min_funds: int = 3,
                              limit: int = 20) -> dict:
    """Cross-fund 'layering': stock-pickers piling into the SAME new name in days.

    A layering pattern is a ticker where >= ``min_funds`` distinct institutional
    funds each opened a BRAND-NEW position (held nothing -> holds it) inside a
    rolling window of ``window_days`` trading days. Daily granularity is the
    whole point: only day-by-day snapshots reveal the *order* funds piled in
    ("ARK Mon -> Corgi Tue -> Avantis Wed") — a quarterly 13F can't.

    Only genuine stock-pickers count (``is_institutional_fund`` — the pure
    option-income books churn equities for their overlay, not from conviction),
    and only equity entries (options excluded). Ranked by a conviction score
    that blends distinct funds, distinct *families* (cross-provider layering is
    the strong signal), and combined AUM.
    """
    window_days = max(2, int(window_days))
    min_funds = max(2, int(min_funds))

    dates = get_available_dates()          # ISO strings, newest-first, trading days
    if len(dates) < 2:
        return {'asOfDate': get_as_of_date(), 'windowDays': window_days,
                'minFunds': min_funds, 'patterns': [], 'total': 0}

    ordered = list(reversed(dates))        # oldest -> newest
    # Scan recent entries so patterns are *active*; read one extra prior snapshot
    # so we can tell "brand new" from "already held" on the earliest scanned day.
    scan_len = min(len(ordered) - 1, max(window_days * 2, 10))
    start = len(ordered) - scan_len        # first index we detect entries ON (needs start-1)

    # Read each needed snapshot once; index maps by trading-day position.
    maps: dict[int, dict] = {}
    for i in range(start - 1, len(ordered)):
        maps[i] = _build_map(_read_csv(os.path.join(HISTORY_DIR, f'holdings_{ordered[i]}.csv')))

    def _held(m: dict, fund: str, ticker: str) -> bool:
        row = m.get((fund, ticker))
        return bool(row) and not row.get('option_type') and row.get('weight', 0) > 0

    # Collect each fund's FIRST new-entry per ticker within the scan window.
    # events[ticker][fund] = {idx, date, weight, name, sector}
    events: dict[str, dict[str, dict]] = defaultdict(dict)
    for i in range(start, len(ordered)):
        curr, prev = maps[i], maps[i - 1]
        for (fund, ticker), row in curr.items():
            if row.get('option_type') or row.get('weight', 0) <= 0:
                continue
            if not ticker or _is_junk_ticker(ticker) or not is_institutional_fund(fund):
                continue
            if _held(prev, fund, ticker):
                continue                    # not new — already held yesterday
            if fund not in events[ticker]:  # keep the earliest entry in-window
                events[ticker][fund] = {
                    'idx': i, 'date': ordered[i], 'weight': round(row.get('weight', 0), 4),
                    'name': row.get('name', ''), 'sector': row.get('sector', ''),
                }

    patterns: list[dict] = []
    for ticker, per_fund in events.items():
        entries = sorted(per_fund.items(), key=lambda kv: kv[1]['idx'])  # (fund, ev)
        # Slide a window_days-wide window; find the densest distinct-fund cluster.
        best: list = []
        lo = 0
        for hi in range(len(entries)):
            while entries[hi][1]['idx'] - entries[lo][1]['idx'] > window_days - 1:
                lo += 1
            if hi - lo + 1 > len(best):
                best = entries[lo:hi + 1]
        if len(best) < min_funds:
            continue

        funds = [f for f, _ in best]
        providers = sorted({FUND_PROVIDERS.get(f, f) for f in funds})
        consensus_aum = round(sum(get_fund_aum(f) for f in funds), 3)
        first_idx = best[0][1]['idx']
        meta = best[-1][1]                  # freshest entry carries name/sector
        seq = [{
            'fund': f, 'provider': FUND_PROVIDERS.get(f, f),
            'entryDate': ev['date'], 'weight': ev['weight'],
            'aum': get_fund_aum(f), 'daysIntoLayering': ev['idx'] - first_idx,
        } for f, ev in best]
        # Cross-FAMILY layering (independent shops agreeing) is the strong
        # signal, so distinct providers carry more weight than raw fund count.
        raw = len(funds) + 1.25 * len(providers) + 0.3 * (consensus_aum ** 0.5)
        patterns.append({
            'ticker': ticker, 'name': meta['name'], 'sector': meta['sector'],
            'distinctFunds': len(funds), 'distinctProviders': len(providers),
            'providers': providers, 'consensusAum': consensus_aum,
            'firstEntry': best[0][1]['date'], 'lastEntry': best[-1][1]['date'],
            'entrySequence': seq, '_raw': raw,
        })

    patterns.sort(key=lambda p: p['_raw'], reverse=True)
    total = len(patterns)
    patterns = patterns[:max(1, int(limit))]
    top = patterns[0]['_raw'] if patterns else 1.0
    for p in patterns:
        p['layeringStrength'] = round(100 * p.pop('_raw') / top) if top else 0

    return {'asOfDate': dates[0], 'windowDays': window_days, 'minFunds': min_funds,
            'patterns': patterns, 'total': total}


def get_activity(period: str = 'daily', *, category: str | None = None) -> dict:
    """
    Bucket changes into accumulating / reducing / optionsActivity.
    `period` accepts 'daily' (latest two snapshots), 'weekly' (~7 calendar
    days) or 'monthly' (~30 calendar days).
    """
    if period == 'weekly':
        changes = compute_weekly_changes(include_options=True)
    elif period == 'monthly':
        changes = compute_monthly_changes(include_options=True)
    else:
        changes = compute_daily_changes_with_options()
    return _activity_from(_filter_by_category(changes, category))


def get_briefing() -> dict:
    """Pre-market briefing — top moves, multi-provider convergence, streaks, options."""
    changes = compute_daily_changes_with_options()
    streaks = _compute_streaks()
    signals = _signals_from([c for c in changes if not c.get('isOption')], streaks)
    activity = _activity_from(changes)
    return _briefing_from(signals, activity, streaks)


def get_all_holdings() -> dict:
    """
    Return every latest holding row across every tracked fund, enriched with
    today's weightDelta + sharesDelta. Used by the dashboard's full-holdings
    page (review #10 finale).
    """
    latest = get_latest_holdings()
    # Build a prev-day map keyed on (fund, ticker) for delta computation.
    prev_map: dict[tuple[str, str], dict] = {}
    for r in get_previous_holdings():
        key = (r.get('ETF Ticker', ''), _clean_ticker(r.get('Ticker', '')))
        prev_map[key] = {
            'weight': _safe_float(r.get('Weight', '0')),
            'shares': _safe_float(r.get('Share Quantity', '0')),
        }

    rows: list[dict] = []
    for r in latest:
        fund = r.get('ETF Ticker', '')
        ticker = _clean_ticker(r.get('Ticker', ''))
        weight = _safe_float(r.get('Weight', '0'))
        shares = _safe_float(r.get('Share Quantity', '0'))
        prev = prev_map.get((fund, ticker))
        rows.append({
            'fund': fund,
            'ticker': ticker,
            'name': r.get('Name', ''),
            'sector': r.get('Sector', '') or _SECTOR_FALLBACK.get(ticker, ''),
            'weight': weight,
            'shares': shares,
            'weightDelta': round(weight - prev['weight'], 4) if prev else 0.0,
            'sharesDelta': round(shares - prev['shares'], 2) if prev else 0.0,
            'isOption': bool(r.get('Option_Type')),
            'cusip': r.get('CUSIP', ''),
        })
    return {
        'asOfDate': get_as_of_date(),
        'count': len(rows),
        'holdings': rows,
    }


def get_fund_detail(fund: str) -> dict | None:
    """
    Full detail for a specific fund. Enriched in review #10 with per-holding
    weightDelta/sharesDelta vs. previous day and a recentChanges list.
    """
    latest = get_latest_holdings()
    fund_rows = [r for r in latest if r.get('ETF Ticker') == fund]
    if not fund_rows:
        return None

    # Previous-day map for delta computation
    prev_map: dict[str, dict] = {}
    for r in get_previous_holdings():
        if r.get('ETF Ticker') == fund and not r.get('Option_Type') and not _is_junk_ticker(r.get('Ticker', '')):
            prev_map[_clean_ticker(r.get('Ticker', ''))] = {
                'weight': _safe_float(r.get('Weight', '0')),
                'shares': _safe_float(r.get('Share Quantity', '0')),
            }

    equities = []
    options = []
    for r in fund_rows:
        if r.get('Option_Type', ''):
            options.append(r)
        elif not _is_junk_ticker(r.get('Ticker', '')):
            ticker = _clean_ticker(r.get('Ticker', ''))
            weight = _safe_float(r.get('Weight', '0'))
            shares = _safe_float(r.get('Share Quantity', '0'))
            prev = prev_map.get(ticker)
            equities.append({
                'ticker': ticker,
                'name': r.get('Name', ''),
                'weight': weight,
                'shares': shares,
                'sector': r.get('Sector', '') or _SECTOR_FALLBACK.get(ticker, ''),
                'weightDelta': round(weight - prev['weight'], 4) if prev else 0.0,
                'sharesDelta': round(shares - prev['shares'], 2) if prev else 0.0,
            })

    equities.sort(key=lambda x: -x['weight'])

    # Current option book — the fund's live option positions (type/strike/
    # expiry/underlying). Used by the income-fund Portfolio section.
    option_holdings = []
    for r in options:
        option_holdings.append({
            'ticker': _clean_ticker(r.get('Ticker', '')),
            'name': r.get('Name', ''),
            'weight': _safe_float(r.get('Weight', '0')),
            'shares': _safe_float(r.get('Share Quantity', '0')),
            'optionType': r.get('Option_Type', ''),
            'underlying': r.get('Underlying_Ticker', ''),
            'strike': _safe_float(r.get('Option_Strike', '0')),
            'expiry': r.get('Option_Expiry', ''),
            # Option analytics — already produced by the scraper, surfaced here
            # for the option-income fund page (ITM/OTM badges, days-to-expiry,
            # distance-to-strike). Nullable: a blank column must not read as a
            # real 0-DTE / at-the-money value.
            'dte': _nullable_float(r.get('DTE')),
            'moneyness': _nullable_float(r.get('Moneyness')),
            'underlyingPrice': _nullable_float(r.get('Underlying_Price')),
        })
    option_holdings.sort(key=lambda x: -abs(x['weight']))

    # Recent changes for this fund — include option activity so the
    # option-income view can show contracts opened/closed, not just equities.
    recent_changes = [c for c in compute_daily_changes_with_options() if c['fund'] == fund]

    # Enrich topHoldings with activeWeightDelta (drift-adjusted) from the
    # changes computation, which already does the per-fund renormalization.
    # Falls back to 0.0 for unchanged positions (no real share move → delta ≈ 0).
    _active_map = {
        c['ticker']: c['activeWeightDelta']
        for c in recent_changes
        if not c.get('isOption')
    }
    for e in equities:
        e['activeWeightDelta'] = _active_map.get(e['ticker'], 0.0)

    # Active accumulation / distribution streaks among this fund's holdings —
    # consecutive-day weight moves of magnitude >= 2 days. Drives the streak
    # tracker on the active-equity fund view.
    fund_streaks = sorted(
        (
            {
                'ticker': tk,
                'days': abs(days),
                'direction': 'up' if days > 0 else 'down',
            }
            for (fd, tk), days in _compute_streaks().items()
            if fd == fund
        ),
        key=lambda s: -s['days'],
    )

    # Net fund flow — change in shares outstanding over the recent window, as a
    # percent of shares outstanding. Shares outstanding move only via
    # creations/redemptions, so this is the fund's organic growth from inflows
    # vs outflows. We deliberately do NOT dollar-value it: the scraper's
    # per-share price is unreliable for several providers, and a bad price
    # produces a wildly wrong dollar figure (a $50M fund showed "+$2.9B").
    # Share counts are clean integer data. None when the provider doesn't
    # report shares outstanding at all (ARK and Avantis don't; option-income
    # and Corgi funds do).
    def _fund_shares_out(rows: list[dict]) -> float | None:
        """Shares outstanding for `fund` — a fund-level field repeated on every
        row; return the first non-blank value seen."""
        for r in rows:
            if r.get('ETF Ticker') != fund:
                continue
            so = _nullable_float(r.get('SharesOutstanding') or r.get('shares_outstanding'))
            if so is not None:
                return so
        return None

    so_now = _fund_shares_out(latest)
    flow = None
    latest_date = _parse_iso(get_as_of_date())
    if so_now is not None and so_now > 0 and latest_date is not None:
        # Compare against the furthest-back snapshot within 7 days that still
        # reports shares outstanding for this fund. The scraper began capturing
        # it only recently, so a 7-day-old file may not have it yet —
        # periodDays reflects the real span actually found.
        for d in get_available_dates()[1:]:
            pd = _parse_iso(d)
            if pd is None:
                continue
            span = (latest_date - pd).days
            if span > 7:
                break
            so_then = _fund_shares_out(
                _read_csv(os.path.join(HISTORY_DIR, f'holdings_{d}.csv'))
            )
            if so_then is not None:
                shares_delta = so_now - so_then
                flow = {
                    'sharesOutstanding': round(so_now, 0),
                    'sharesDelta': round(shares_delta, 0),
                    'flowPct': round((shares_delta / so_now) * 100, 2),
                    'periodDays': span,
                }

    # Option rolls — a contract closed + another opened on the same underlying
    # (same call/put) is the fund rolling its position, e.g. NVDA C200 -> C210.
    # Framed as strategy mechanics, not a buy + a sell.
    roll_groups: dict[tuple[str, str], dict] = defaultdict(lambda: {'closed': [], 'opened': []})
    for c in recent_changes:
        if not c.get('isOption'):
            continue
        od = c.get('optionDetails') or {}
        underlying = od.get('underlying') or ''
        if not underlying:
            continue
        leg = {'strike': od.get('strike', 0.0), 'expiry': od.get('expiry', '')}
        key = (underlying, od.get('type') or '')
        if c['type'] == 'REMOVED':
            roll_groups[key]['closed'].append(leg)
        elif c['type'] == 'NEW':
            roll_groups[key]['opened'].append(leg)
    option_rolls = [
        {
            'underlying': underlying,
            'optionType': otype,
            'closed': grp['closed'],
            'opened': grp['opened'],
        }
        for (underlying, otype), grp in sorted(roll_groups.items())
        if grp['closed'] and grp['opened']
    ]

    return {
        'fund': fund,
        'provider': FUND_PROVIDERS.get(fund, fund),
        'category': get_fund_category(fund),
        'aum': get_fund_aum(fund),
        'asOfDate': get_as_of_date(),
        'holdingsCount': len(equities),
        'optionsCount': len(options),
        'totalWeight': round(sum(e['weight'] for e in equities), 2),
        'topHoldings': equities[:20],
        'optionHoldings': option_holdings,
        'recentChanges': recent_changes,
        'streaks': fund_streaks,
        'flow': flow,
        'optionRolls': option_rolls,
    }


def get_ticker_detail(ticker: str) -> dict | None:
    """
    Cross-fund detail for a specific ticker. Enriched in review #10 with
    optionDetails per option holding and a `changes` list of recent moves.
    """
    latest = get_latest_holdings()
    matches = [
        r for r in latest
        if _clean_ticker(r.get('Ticker', '')) == ticker
        or r.get('Underlying_Ticker', '') == ticker
    ]
    if not matches:
        return None

    funds = []
    for r in matches:
        fund = r.get('ETF Ticker', '')
        is_option = bool(r.get('Option_Type'))
        entry: dict = {
            'fund': fund,
            'provider': FUND_PROVIDERS.get(fund, fund),
            'weight': _safe_float(r.get('Weight', '0')),
            'shares': _safe_float(r.get('Share Quantity', '0')),
            'isOption': is_option,
            # $B, from get_fund_aum() — added so /api/v1/ticker/{t} can drive
            # dollar-exposure estimates without a separate client-side lookup.
            'aum': get_fund_aum(fund),
        }
        if is_option:
            entry['optionDetails'] = {
                'type': r.get('Option_Type', ''),
                'strike': _safe_float(r.get('Option_Strike', '0')),
                'expiry': r.get('Option_Expiry', ''),
            }
        funds.append(entry)

    funds.sort(key=lambda x: -x['weight'])

    # Name/sector from an EQUITY row, not an option (an option row's Name is the
    # contract string, e.g. "NVDA 06/18/2026 186 C" — wrong for the header).
    name_src = next((m for m in matches if not m.get('Option_Type')), matches[0])

    # Recent changes that match this ticker (or its option underlying)
    all_changes = compute_daily_changes_with_options()
    changes = [
        c for c in all_changes
        if c['ticker'] == ticker
        or (c.get('isOption') and c.get('optionDetails', {}).get('underlying') == ticker)
    ]

    return {
        'ticker': ticker,
        'name': name_src.get('Name', ''),
        'sector': name_src.get('Sector', '') or _SECTOR_FALLBACK.get(ticker, ''),
        'fundCount': len({f['fund'] for f in funds}),
        'holdings': funds,
        'totalWeight': round(sum(f['weight'] for f in funds if not f['isOption']), 4),
        'changes': changes,
    }


def _blended_weight_for(rows: list[dict], ticker: str, total_aum: float) -> tuple[float, int]:
    """AUM-blended institutional weight of a single ticker in one snapshot.

    Returns (blended_weight_pct, holding_fund_count). Mirrors the per-ticker
    contribution in _blend_institutional but for just one name, so we can walk
    the history cheaply.
    """
    w = 0.0
    funds = 0
    for r in rows:
        if r.get('Option_Type'):
            continue
        fund = r.get('ETF Ticker', '')
        if not is_institutional_fund(fund):
            continue
        aum = get_fund_aum(fund)
        if aum <= 0:
            continue
        if _clean_ticker(r.get('Ticker', '')) != ticker:
            continue
        w += _safe_float(r.get('Weight', '0')) * aum / total_aum
        funds += 1
    return w, funds


def get_stock_detail(ticker: str, history_days: int = 30) -> dict | None:
    """Per-stock page payload: cross-fund holders + the institutional trend.

    Builds on get_ticker_detail (holders, recent changes) and adds the
    AUM-blended institutional view: the day/week/month deltas + A/D signal,
    plus a trading-day history series of the blended weight and ownership
    breadth so the page can chart the name's trend over time.
    """
    ticker = _clean_ticker(ticker)
    base = get_ticker_detail(ticker)
    if not base:
        return None

    latest = get_latest_holdings()
    inst_funds = {r.get('ETF Ticker', '') for r in latest
                  if is_institutional_fund(r.get('ETF Ticker', ''))}
    total_aum = sum(get_fund_aum(f) for f in inst_funds) or 1.0

    # Trading-day history series (oldest → newest) for charting.
    dates = get_available_dates()[:history_days]  # newest-first, trading days only
    history = []
    for d in reversed(dates):
        rows = _read_csv(os.path.join(HISTORY_DIR, f'holdings_{d}.csv'))
        w, fc = _blended_weight_for(rows, ticker, total_aum)
        history.append({'date': d, 'blendedWeight': round(w, 4), 'fundCount': fc})

    cur = history[-1]['blendedWeight'] if history else 0.0
    prev = get_previous_holdings()
    wk = _snapshot_for_lookback(7)
    mo = _snapshot_for_lookback(30)
    daily = cur - (_blended_weight_for(prev, ticker, total_aum)[0] if prev else cur)
    weekly = cur - (_blended_weight_for(wk, ticker, total_aum)[0] if wk else cur)
    monthly = cur - (_blended_weight_for(mo, ticker, total_aum)[0] if mo else cur)

    # Blended-weight streak — consecutive daily moves in the same direction.
    # Computed from the history already loaded; no extra file reads.
    streak = 0
    if len(history) >= 2:
        for i in range(len(history) - 1, 0, -1):
            delta = history[i]['blendedWeight'] - history[i - 1]['blendedWeight']
            if delta > 0.001:
                if streak >= 0:
                    streak += 1
                else:
                    break
            elif delta < -0.001:
                if streak <= 0:
                    streak -= 1
                else:
                    break
            else:
                break

    # Estimated dollar exposure: sum of (weight% × fund AUM $B × 10) across
    # institutional equity holders. Rough but useful — turns "0.8% blended weight"
    # into "~$890M" so traders have a concrete size anchor.
    exposure_m = round(sum(
        h['weight'] / 100 * get_fund_aum(h['fund']) * 1000
        for h in base['holdings']
        if not h['isOption'] and is_institutional_fund(h['fund'])
    ), 1)

    return {
        **base,
        'institutional': {
            'blendedWeight': round(cur, 4),
            'daily': round(daily, 4),
            'weekly': round(weekly, 4),
            'monthly': round(monthly, 4),
            'fundCount': history[-1]['fundCount'] if history else 0,
            'signal': _trend_signal(monthly, weekly, daily),
            'streak': streak if abs(streak) >= 2 else None,
            'estimatedExposureM': exposure_m,
        },
        'history': history,
    }


def get_funds_index(*, category: str | None = None) -> list[dict]:
    """All tracked funds enriched with holdings counts and top holding.

    Powers the /funds index page (HedgeFollow-style "funds we follow" list).
    Based on the funds actually present in the latest snapshot, so delisted
    funds drop off; provider/category/AUM come from the static maps.
    """
    latest = get_latest_holdings()
    by_fund: dict[str, dict] = {}
    for r in latest:
        fund = r.get('ETF Ticker', '')
        if not fund or fund in EXCLUDED_FUNDS:
            continue
        if category and get_fund_category(fund) != category:
            continue
        d = by_fund.setdefault(fund, {'holdings': 0, 'options': 0, 'top': None})
        if r.get('Option_Type'):
            d['options'] += 1
            continue
        ticker = _clean_ticker(r.get('Ticker', ''))
        if _is_junk_ticker(ticker):
            continue
        d['holdings'] += 1
        w = _safe_float(r.get('Weight', '0'))
        if d['top'] is None or w > d['top']['weight']:
            d['top'] = {'ticker': ticker, 'weight': round(w, 4)}

    out = []
    for fund in sorted(by_fund):
        d = by_fund[fund]
        if d['holdings'] == 0 and d['options'] == 0:
            continue
        out.append({
            'fund': fund,
            'provider': FUND_PROVIDERS.get(fund, 'Other'),
            'category': get_fund_category(fund),
            'aum': get_fund_aum(fund),
            'holdingsCount': d['holdings'],
            'optionsCount': d['options'],
            'topHolding': d['top'],
        })
    return out


def get_tickers_index(limit: int = 100, sort: str = 'funds', *,
                      category: str | None = None) -> list[dict]:
    """Most widely-held underlying tickers across all tracked funds.

    Powers the /stocks index page (HedgeFollow-style "most popular stocks").
    Equities only — options are excluded. `sort` is 'funds' (breadth of
    ownership, default) or 'weight' (total weight summed across funds). Each
    row also carries the net daily weight change, a list of any funds that
    opened a brand-new position today, and the strongest multi-day
    accumulation/distribution streak across any fund holding the ticker.
    """
    latest = get_latest_holdings()
    daily: dict[str, float] = {}
    new_entries: dict[str, list[str]] = {}
    exits: dict[str, list[str]] = {}
    for c in _filter_by_category(compute_daily_changes(), category):
        ticker = c['ticker']
        daily[ticker] = daily.get(ticker, 0.0) + (c.get('activeWeightDelta') or c['weightDelta'])
        if c.get('type') == 'NEW':
            new_entries.setdefault(ticker, []).append(c['fund'])
        elif c.get('type') == 'REMOVED':
            exits.setdefault(ticker, []).append(c['fund'])

    # Per-ticker streak: strongest (by abs value) fund-level streak for each ticker.
    # Positive = buying, negative = selling. None = no streak of 2+ days.
    raw_streaks = _filter_streaks_by_category(_compute_streaks(), category)
    ticker_streaks: dict[str, int] = {}
    for (_, ticker), streak_val in raw_streaks.items():
        if ticker not in ticker_streaks or abs(streak_val) > abs(ticker_streaks[ticker]):
            ticker_streaks[ticker] = streak_val

    agg: dict[str, dict] = {}
    for r in latest:
        if r.get('Option_Type'):
            continue
        fund = r.get('ETF Ticker', '')
        if fund in EXCLUDED_FUNDS:
            continue
        if category and get_fund_category(fund) != category:
            continue
        ticker = _clean_ticker(r.get('Ticker', ''))
        if _is_junk_ticker(ticker):
            continue
        d = agg.setdefault(ticker, {
            'name': r.get('Name', ''), 'sector': r.get('Sector', '') or _SECTOR_FALLBACK.get(ticker, ''),
            'funds': set(), 'providers': set(), 'totalWeight': 0.0,
        })
        d['funds'].add(fund)
        d['providers'].add(FUND_PROVIDERS.get(fund, fund))
        d['totalWeight'] += _safe_float(r.get('Weight', '0'))

    rows = [{
        'ticker': t,
        'name': d['name'],
        'sector': d['sector'],
        'fundCount': len(d['funds']),
        'funds': sorted(d['funds']),
        'distinctProviders': len(d['providers']),
        'totalWeight': round(d['totalWeight'], 4),
        'netChange': round(daily.get(t, 0.0), 4),
        'newEntryFunds': sorted(new_entries.get(t, [])),
        'exitFunds': sorted(exits.get(t, [])),
        'streak': ticker_streaks.get(t),
    } for t, d in agg.items()]

    if sort == 'weight':
        rows.sort(key=lambda x: -x['totalWeight'])
    else:
        rows.sort(key=lambda x: (-x['fundCount'], -x['totalWeight']))
    return rows[:limit]


def get_full_payload(*, category: str | None = None) -> dict:
    """
    Complete API payload — the single endpoint everything else can be derived from.

    Compute changes (including options) ONCE, derive an equity-only view by
    filtering, then thread both through every downstream computation. (Review
    #14 + #10 finale.)
    """
    changes_all = _filter_by_category(compute_daily_changes_with_options(), category)
    changes_eq = [c for c in changes_all if not c.get('isOption')]
    streaks = _filter_streaks_by_category(_compute_streaks(), category)
    signals = _signals_from(changes_eq, streaks)
    activity = _activity_from(changes_all)
    return {
        '_meta': {
            'endpoint': '/api/v1/signals',
            'description': 'TickerTrace public API — institutional ETF activity signals.',
            'source': 'FastAPI + FastMCP',
        },
        'asOfDate': get_as_of_date(),
        'category': category,  # null when unfiltered — echoes the applied filter
        'stats': get_global_stats(changes_eq),  # reuse already-computed equity changes
        'signals': signals,
        'changes': changes_eq[:50],
        'sectorFlow': _sector_flow_from(changes_eq),
        'divergences': _divergences_from(changes_eq),
        'briefing': _briefing_from(signals, activity, streaks),
        'activity': activity,
    }
