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
CHANGE = obj(positionUsd=P['positionUsd'], activeFlowUsd=P['activeFlowUsd'])
FUND = obj(**AUM['properties'], topHoldings=array(HOLDING),
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
    '/api/v1/ticker/{ticker}': obj(holdings=array(obj(**AUM['properties'], positionUsd=P['positionUsd'])), changes=array(CHANGE)),
    '/api/v1/holdings': obj(holdings=array(HOLDING)),
    '/api/v1/changes': obj(changes=array(CHANGE)),
    '/api/v1/layering-patterns': obj(patterns=array(PATTERN)),
    '/api/v1/income': obj(funds=array(AUM)),
    '/api/v1/income/{fund}': AUM,
    '/api/v1/briefing': BRIEFING,
    '/api/v1/activity': ACTIVITY,
    '/api/v1/signals': obj(signals=obj(buying=array(SIGNAL), selling=array(SIGNAL)),
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
        app.openapi_schema = schema
        return schema
    app.openapi = openapi
