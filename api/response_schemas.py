"""Additive OpenAPI documentation for flexible dictionary responses.

These schemas describe fields without validating/stripping existing payloads.
Unknown properties remain allowed so legacy dashboard/MCP data is preserved.
"""
from fastapi.openapi.utils import get_openapi


def obj(**properties):
    return {'type': 'object', 'properties': properties, 'additionalProperties': True}


def array(items):
    return {'type': 'array', 'items': items}


def amount(description, integer=False):
    return {'type': ['integer' if integer else 'number', 'null'], 'description': description}


DOLLARS = obj(
    aum=amount('Fund AUM in billions of US dollars ($B); legacy field; null when AUM is unavailable.'),
    aumUsd=amount('Fund AUM in whole US dollars; null when AUM is unavailable.', True),
    positionUsd=amount('Estimated signed position value in whole USD: weight percent × fund AUM / 100. Uses latest fund AUM, including historical entry estimates; null when AUM is unavailable. Option values are premiums, not underlying notional.', True),
    activeFlowUsd=amount('Estimated signed active allocation flow in whole USD: activeWeightDelta percentage points × latest fund AUM / 100. Not actual execution proceeds; null when AUM is unavailable.', True),
)
# Reuse documented properties on the specific row shapes where they exist.
P = DOLLARS['properties']
AUM = obj(aum=P['aum'], aumUsd=P['aumUsd'])
HOLDING = obj(positionUsd=P['positionUsd'])
HOLDINGS_ROW = obj(
    positionUsd=P['positionUsd'],
    weightDelta=amount('Raw day-over-day weight change in percentage points (includes price drift). Null for a catch-up fund.'),
    sharesDelta=amount('Day-over-day share change. Null for a catch-up fund.'),
    activeWeightDelta=amount('Drift-adjusted weight change (percentage points): the manager-attributable move, equal to the website Δ Weight. 0 when unchanged; null for a catch-up fund (see catchUpSince).'),
    catchUpSince={'type': 'string', 'description': 'Present on a catch-up fund: its daily deltas are withheld (null) because they would span a stale gap since this date.'},
    assetClass={'type': 'string', 'enum': ['equity', 'option', 'cash', 'treasury', 'swap', 'other']},
    dte=amount('Days to expiry as written in the issuer snapshot (options only; null otherwise). Not recomputed from today.'),
)
DIRECTION = {'type': 'string', 'enum': ['buying', 'selling', 'unchanged'],
             'description': 'Which way the position was traded, from the split-adjusted share count: a fund whose share count rose is buying, one whose count fell is selling, no share move is unchanged (NEW is buying, REMOVED is selling; the active delta decides only when no share count is usable). Use this for ADD/TRIM labels. It can legitimately disagree with the sign of activeWeightDelta, which nets the trade against the fund\'s pro-rata flow (a buy smaller than the day\'s inflow is buying with a slightly negative active tilt). The direction= query filter keys off the activeWeightDelta sign.'}
CHANGE = obj(positionUsd=P['positionUsd'], activeFlowUsd=P['activeFlowUsd'], direction=DIRECTION)
# What the deltas in a response are measured against. A catch-up fund's own span is catchUpSince -> asOfDate (its deltas are null).
COMPARISON = dict(
    previousDate={'type': ['string', 'null'], 'description': 'Date of the earlier snapshot the deltas in this response are measured against (the prior trading-day file for daily deltas; the ~7 / ~30 calendar-day lookback for weekly / monthly changes). Null with fewer than two snapshots. Not the span of a catch-up fund: its deltas are null (see catchUpSince).'},
    comparisonTradingDays={'type': ['integer', 'null'], 'description': 'Trading days between previousDate and asOfDate (1 = consecutive sessions; more across a holiday or a missed scrape).'},
)
FUND = obj(**COMPARISON, **AUM['properties'], topHoldings=array(HOLDING),
           optionHoldings=array(HOLDING), recentChanges=array(CHANGE))
SIGNAL = obj(fundDetails=array(AUM))
BRIEFING = obj(topBuys=array(SIGNAL), topSells=array(SIGNAL),
               crossFundConvergence=array(SIGNAL),
               notableOptions=array(obj(record=CHANGE)))
ACTIVITY = obj(accumulating=array(CHANGE), reducing=array(CHANGE), optionsActivity=array(CHANGE))
PATTERN = obj(
    consensusAum=amount('Combined participating fund AUM in billions of USD, rounded to three decimals; not capital invested in this ticker; null if any AUM is unknown.'),
    consensusAumUsd=amount('Combined participating fund AUM in whole USD (sum of unrounded individual AUM); null if any AUM is unknown.', True),
    positionUsdTotal=amount('Estimated total entry-position value in whole USD: sum of entry weights × latest respective fund AUM / 100. Null if any AUM is unknown.', True),
    entrySequence=array(obj(**AUM['properties'], positionUsd=P['positionUsd'])),
)

RESPONSES = {
    '/api/v1/funds': obj(funds=array(AUM)),
    '/api/v1/fund/{fund}': FUND,
    '/api/v1/stock/{ticker}': obj(holdings=array(obj(**AUM['properties'], positionUsd=P['positionUsd']))),
    '/api/v1/ticker/{ticker}': obj(**COMPARISON, holdings=array(obj(**AUM['properties'], positionUsd=P['positionUsd'])), changes=array(CHANGE)),
    '/api/v1/holdings': obj(
        **COMPARISON,
        total={'type': 'integer', 'description': 'Rows matching the filters (before paging).'},
        page={'type': 'integer'}, size={'type': 'integer'}, pages={'type': 'integer'},
        holdings=array(HOLDINGS_ROW)),
    '/api/v1/changes': obj(changes=array(CHANGE), **COMPARISON,
        total={'type': 'integer', 'description': 'All rows matching filters, before paging. Present only with page/size.'},
        page={'type': 'integer', 'description': '1-based page; present only with page/size.'},
        size={'type': 'integer', 'description': 'Page size (1–2000); present only with page/size.'},
        pages={'type': 'integer', 'description': 'Total pages; 0 for an empty filtered universe.'},
        snapshot={'type': 'string', 'description': 'Opaque comparison-window snapshot token. Pass on later pages; 409 means restart at page 1.'} ),
    '/api/v1/layering-patterns': obj(patterns=array(PATTERN)),
    '/api/v1/income': obj(funds=array(AUM)),
    '/api/v1/income/{fund}': AUM,
    '/api/v1/briefing': BRIEFING,
    '/api/v1/activity': ACTIVITY,
    '/api/v1/signals': obj(**COMPARISON, signals=obj(buying=array(SIGNAL), selling=array(SIGNAL)),
                           changes=array(CHANGE), briefing=BRIEFING, activity=ACTIVITY),
}


def install_response_schemas(app):
    def openapi():
        if app.openapi_schema:
            return app.openapi_schema
        schema = get_openapi(title=app.title, version=app.version,
                             description=app.description, routes=app.routes,
                             servers=app.servers, tags=app.openapi_tags)
        schema.setdefault('components', {}).setdefault('schemas', {})['DollarFields'] = DOLLARS
        for path, response in RESPONSES.items():
            operation = schema['paths'].get(path, {}).get('get')
            if operation:
                operation['responses']['200']['content']['application/json']['schema'] = response
        changes = schema['paths'].get('/api/v1/changes', {}).get('get', {})
        if changes:
            changes['responses']['200']['content']['text/csv'] = {'schema': {'type': 'string', 'description': 'format=csv: uncapped filtered export; unknown values are blank.'}}
            changes['responses']['409'] = {'description': 'Snapshot token no longer matches. Restart at page 1.'}
            changes['responses']['503'] = {'description': 'Snapshot changed repeatedly during computation. Retry.'}
        app.openapi_schema = schema
        return schema
    app.openapi = openapi
