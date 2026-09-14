import requests
from bs4 import BeautifulSoup
import pandas as pd
import re
import datetime
import os
import sys
import time
import io
import glob
import sqlite3
import urllib.parse
import yfinance as yf
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from db_setup import setup_database
from cusip_lookup import CusipLookup


# ─── HTTP helpers with retry (review #17) ───────────────────────────
# Transient 5xx / connection errors / read timeouts retry up to 3 times
# with exponential backoff (2s, 4s, 8s capped at 10s). 4xx errors don't
# retry — those mean the URL is wrong, retrying won't help.
_RETRY = retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception_type((
        requests.exceptions.ConnectionError,
        requests.exceptions.Timeout,
        requests.exceptions.ChunkedEncodingError,
    )),
)


@_RETRY
def _http_get(url: str, headers: dict | None = None, timeout: int = 30) -> requests.Response:
    """GET with retry on transient network errors. 4xx/5xx still surface to caller."""
    response = requests.get(url, headers=headers, timeout=timeout)
    # 5xx are typically transient — raise so tenacity retries.
    if 500 <= response.status_code < 600:
        response.raise_for_status()
    return response


@_RETRY
def _http_post(url: str, headers: dict | None = None, data: dict | None = None, timeout: int = 30) -> requests.Response:
    """POST with retry on transient network errors."""
    response = requests.post(url, headers=headers, data=data, timeout=timeout)
    if 500 <= response.status_code < 600:
        response.raise_for_status()
    return response

# Configuration
FUNDS = [
    {'ticker': 'AVUV', 'type': 'avantis', 'id': '119'},
    {'ticker': 'AVLV', 'type': 'avantis', 'id': '806'},
    {'ticker': 'AVMV', 'type': 'avantis', 'id': '823'},
    {'ticker': 'AVEM', 'type': 'avantis', 'id': '118'},
    {'ticker': 'AVDV', 'type': 'avantis', 'id': '120'},
    {'ticker': 'AVDE', 'type': 'avantis', 'id': '116'},
    {'ticker': 'AVUS', 'type': 'avantis', 'id': '114'},
    {'ticker': 'AVSC', 'type': 'avantis', 'id': '457'},
    {'ticker': 'AVES', 'type': 'avantis', 'id': '808'},
    {'ticker': 'AVIV', 'type': 'avantis', 'id': '807'},
    {'ticker': 'KYLD', 'type': 'csv', 'url': 'https://web.services.kurvinvest.com/etfdata/KYLD/holdings.csv'},
    {'ticker': 'KQQQ', 'type': 'csv', 'url': 'https://web.services.kurvinvest.com/etfdata/KQQQ/holdings.csv'},
    {'ticker': 'BLOX', 'type': 'csv', 'url': 'https://nicholasx.com/wp-content/uploads/data/TidalFG_Holdings_BLOX.csv'},
    {'ticker': 'EGGQ', 'type': 'csv', 'url': 'https://nestyield.com/wp-content/uploads/data/TidalFG_Holdings_EGGQ.csv'},
    {'ticker': 'EGGY', 'type': 'csv', 'url': 'https://nestyield.com/wp-content/uploads/data/TidalFG_Holdings_EGGY.csv'},
    {'ticker': 'EGGS', 'type': 'csv', 'url': 'https://nestyield.com/wp-content/uploads/data/TidalFG_Holdings_EGGS.csv'},
    {'ticker': 'ULTY', 'type': 'csv', 'url': 'https://yieldmaxetfs.com/wp-content/uploads/funds/ULTY/TidalFG_Holdings_ULTY.csv'},
    {'ticker': 'SLTY', 'type': 'csv', 'url': 'https://yieldmaxetfs.com/wp-content/uploads/funds/SLTY/TidalFG_Holdings_SLTY.csv'},
    {'ticker': 'CHPY', 'type': 'csv', 'url': 'https://yieldmaxetfs.com/wp-content/uploads/funds/CHPY/TidalFG_Holdings_CHPY.csv'},
    {'ticker': 'YMAX', 'type': 'csv', 'url': 'https://yieldmaxetfs.com/wp-content/uploads/funds/YMAX/TidalFG_Holdings_YMAX.csv'},
    {'ticker': 'AMDY', 'type': 'csv', 'url': 'https://yieldmaxetfs.com/wp-content/uploads/funds/AMDY/TidalFG_Holdings_AMDY.csv'},
    {'ticker': 'AMZY', 'type': 'csv', 'url': 'https://yieldmaxetfs.com/wp-content/uploads/funds/AMZY/TidalFG_Holdings_AMZY.csv'},
    {'ticker': 'GOOY', 'type': 'csv', 'url': 'https://yieldmaxetfs.com/wp-content/uploads/funds/GOOY/TidalFG_Holdings_GOOY.csv'},
    {'ticker': 'GDXY', 'type': 'csv', 'url': 'https://yieldmaxetfs.com/wp-content/uploads/funds/GDXY/TidalFG_Holdings_GDXY.csv'},
    {'ticker': 'ULTI', 'type': 'csv', 'url': 'https://www.rexshares.com/ulti/', 'method': 'post', 'data': {'CSV': 'Download CSV', 'symbol': 'ULTI'}},

    # ARK Invest
    {'ticker': 'ARKK', 'type': 'csv', 'url': 'https://assets.ark-funds.com/fund-documents/funds-etf-csv/ARK_INNOVATION_ETF_ARKK_HOLDINGS.csv'},
    {'ticker': 'ARKQ', 'type': 'csv', 'url': 'https://assets.ark-funds.com/fund-documents/funds-etf-csv/ARK_AUTONOMOUS_TECH._&_ROBOTICS_ETF_ARKQ_HOLDINGS.csv'},
    {'ticker': 'ARKW', 'type': 'csv', 'url': 'https://assets.ark-funds.com/fund-documents/funds-etf-csv/ARK_NEXT_GENERATION_INTERNET_ETF_ARKW_HOLDINGS.csv'},
    {'ticker': 'ARKG', 'type': 'csv', 'url': 'https://assets.ark-funds.com/fund-documents/funds-etf-csv/ARK_GENOMIC_REVOLUTION_ETF_ARKG_HOLDINGS.csv'},
    {'ticker': 'ARKF', 'type': 'csv', 'url': 'https://assets.ark-funds.com/fund-documents/funds-etf-csv/ARK_FINTECH_INNOVATION_ETF_ARKF_HOLDINGS.csv'},
    {'ticker': 'ARKX', 'type': 'csv', 'url': 'https://assets.ark-funds.com/fund-documents/funds-etf-csv/ARK_SPACE_EXPLORATION_&_INNOVATION_ETF_ARKX_HOLDINGS.csv'},

    # Corgi Funds — thematic + founder-led (JSON API, one call per fund)
    {'ticker': 'EUV',  'type': 'corgi'},  # Lithography & Semiconductor Photonics
    {'ticker': 'CMAG', 'type': 'corgi'},  # Mag 7
    {'ticker': 'CQTM', 'type': 'corgi'},  # Quantum Computing
    {'ticker': 'XA',   'type': 'corgi'},  # AI Cybersecurity
    {'ticker': 'EYES', 'type': 'corgi'},  # Data & Surveillance
    {'ticker': 'KYC',  'type': 'corgi'},  # Digital Banking & Fintech Infrastructure
    {'ticker': 'GNMX', 'type': 'corgi'},  # Genomics & Precision Medicine
    {'ticker': 'AV',   'type': 'corgi'},  # Aerospace & Commercial Aviation
    {'ticker': 'DOCK', 'type': 'corgi'},  # Ports, Rail & Freight
    {'ticker': 'WATS', 'type': 'corgi'},  # Battery Energy Storage
    {'ticker': 'GLAM', 'type': 'corgi'},  # Beauty, Skincare & Aesthetics
    {'ticker': 'NYNY', 'type': 'corgi'},  # NYC Based
    {'ticker': 'STYL', 'type': 'corgi'},  # Style/Fashion
    {'ticker': 'WNDR', 'type': 'corgi'},  # Wonder/Innovation
    {'ticker': 'FDRS', 'type': 'corgi'},  # Founder-Led ETF
    {'ticker': 'FDRX', 'type': 'corgi'},  # Founder-Led 2x Daily

    # Sprott — actively managed precious metals miners
    {'ticker': 'GBUG', 'type': 'sprott', 'url': 'https://sprottetfs.com/gbug-sprott-active-gold-silver-miners-etf/#secHoldings'},

    # Amplify ETFs — thematic + dividend/income (public Google Firestore feed).
    # Holdings live at funds/{TICKER}/holdings/{YYYY-MM-DD} in the
    # amplify-etfs-data-feed project; see get_holdings_amplify.
    {'ticker': 'BLOK', 'type': 'amplify'},  # Blockchain Technology
    {'ticker': 'AIEQ', 'type': 'amplify'},  # AI Powered Equity
    {'ticker': 'ETHO', 'type': 'amplify'},  # Etho Climate Leadership US
    {'ticker': 'IBUY', 'type': 'amplify'},  # Online Retail
    {'ticker': 'HACK', 'type': 'amplify'},  # Cybersecurity
    {'ticker': 'SILJ', 'type': 'amplify'},  # Junior Silver Miners
    {'ticker': 'BATT', 'type': 'amplify'},  # Lithium & Battery Technology
    {'ticker': 'IPAY', 'type': 'amplify'},  # Digital Payments
    {'ticker': 'ITEQ', 'type': 'amplify'},  # Israel Technology
    {'ticker': 'COWS', 'type': 'amplify'},  # Cash Flow Cow (free cash flow)
    {'ticker': 'DRVR', 'type': 'amplify'},  # Autonomous & Electric Vehicles
    {'ticker': 'AWAY', 'type': 'amplify'},  # Travel Tech
    {'ticker': 'CNBS', 'type': 'amplify'},  # Seymour Cannabis
    {'ticker': 'GAMR', 'type': 'amplify'},  # Video Game Tech
    {'ticker': 'DIVO', 'type': 'amplify'},  # CWP Enhanced Dividend Income
    {'ticker': 'QDVO', 'type': 'amplify'},  # Enhanced Nasdaq-100 Income
    {'ticker': 'IDVO', 'type': 'amplify'},  # International Enhanced Dividend Income
    {'ticker': 'YYY',  'type': 'amplify'},  # High Income (fund of closed-end funds)

    # Roundhill WeeklyPay — bulk CSV filtered by Account column
    {'ticker': 'MSTW', 'type': 'roundhill'},
    {'ticker': 'NVDW', 'type': 'roundhill'},
    {'ticker': 'COIW', 'type': 'roundhill'},
    {'ticker': 'TSLW', 'type': 'roundhill'},
    {'ticker': 'HOOW', 'type': 'roundhill'},
    {'ticker': 'PLTW', 'type': 'roundhill'},
    # Roundhill daily/weekly options ETFs
    {'ticker': 'QDTE', 'type': 'roundhill'},
    {'ticker': 'XDTE', 'type': 'roundhill'},
    {'ticker': 'RDTE', 'type': 'roundhill'},
    {'ticker': 'YBTC', 'type': 'roundhill'},
    # YieldMax single-stock
    {'ticker': 'MSTY', 'type': 'csv', 'url': 'https://yieldmaxetfs.com/wp-content/uploads/funds/MSTY/TidalFG_Holdings_MSTY.csv'},
    {'ticker': 'NVDY', 'type': 'csv', 'url': 'https://yieldmaxetfs.com/wp-content/uploads/funds/NVDY/TidalFG_Holdings_NVDY.csv'},
    {'ticker': 'CONY', 'type': 'csv', 'url': 'https://yieldmaxetfs.com/wp-content/uploads/funds/CONY/TidalFG_Holdings_CONY.csv'},
    {'ticker': 'TSLY', 'type': 'csv', 'url': 'https://yieldmaxetfs.com/wp-content/uploads/funds/TSLY/TidalFG_Holdings_TSLY.csv'},
    {'ticker': 'HOOY', 'type': 'csv', 'url': 'https://yieldmaxetfs.com/wp-content/uploads/funds/HOOY/TidalFG_Holdings_HOOY.csv'},
    {'ticker': 'PLTY', 'type': 'csv', 'url': 'https://yieldmaxetfs.com/wp-content/uploads/funds/PLTY/TidalFG_Holdings_PLTY.csv'},
    # REX Shares Growth & Income (weekly pay).
    # MSII/COII/HOII/PLTI were liquidated by REX on 2026-06-16 (trading halted
    # 2026-06-09) — removed from tracking. NVII and TSII were not part of that
    # liquidation and remain live.
    {'ticker': 'NVII', 'type': 'csv', 'url': 'https://www.rexshares.com/nvii/', 'method': 'post', 'data': {'CSV': 'Download CSV', 'symbol': 'NVII'}},
    {'ticker': 'TSII', 'type': 'csv', 'url': 'https://www.rexshares.com/tsii/', 'method': 'post', 'data': {'CSV': 'Download CSV', 'symbol': 'TSII'}},

    # Capital Group — actively managed, multi-manager active-equity ETFs.
    # Daily holdings via a public XLSX download endpoint; see get_holdings_capitalgroup.
    {'ticker': 'CGDV', 'type': 'capitalgroup'},  # Dividend Value
    {'ticker': 'CGGR', 'type': 'capitalgroup'},  # Growth
    {'ticker': 'CGGO', 'type': 'capitalgroup'},  # Global Growth Equity
    {'ticker': 'CGUS', 'type': 'capitalgroup'},  # Core Equity
    {'ticker': 'CGXU', 'type': 'capitalgroup'},  # International Focus Equity

    # First Trust — actively managed (long/short equity, multi-manager small
    # cap, sub-advised international equity, energy infrastructure,
    # crypto-adjacent equity). Holdings page renders server-side; see
    # get_holdings_firsttrust. CIBR (passive, quarterly-rebalanced) and NTRL
    # (swap-based market-neutral, short exposure not cleanly attributable)
    # were deliberately excluded from this pass.
    {'ticker': 'FTLS', 'type': 'firsttrust'},  # Long/Short Equity
    {'ticker': 'WCME', 'type': 'firsttrust'},  # WCM/BNY International Equity
    {'ticker': 'WCMG', 'type': 'firsttrust'},  # WCM/BNY Global Equity
    {'ticker': 'WCMI', 'type': 'firsttrust'},  # WCM/BNY International Small Cap
    {'ticker': 'CRPT', 'type': 'firsttrust'},  # SkyBridge Crypto Industry & Digital Economy
    {'ticker': 'MMSC', 'type': 'firsttrust'},  # Multi Manager Small Cap
    {'ticker': 'EMLP', 'type': 'firsttrust'},  # North American Energy Infrastructure
]

AVANTIS_BASE_URL_TEMPLATE = "https://www.avantisinvestors.com/avantis-investments/total-holdings/{id}/?type=etf"
CORGI_API_URL = "https://cmltk98h4m.execute-api.us-east-2.amazonaws.com/api/v1/holdings"
# Amplify ETFs publish holdings via a public Google Firestore project. Their
# website reads it client-side with this (public) API key; read rules are open
# on the funds/* paths, so the Firestore REST API needs no auth. Same call the
# browser makes — see get_holdings_amplify.
AMPLIFY_FIRESTORE_PROJECT = "amplify-etfs-data-feed"
AMPLIFY_FIRESTORE_KEY = "AIzaSyCibhGo4lu8ZALtBvf_ZT351BDMUPqOYjc"
AMPLIFY_FIRESTORE_BASE = (
    f"https://firestore.googleapis.com/v1/projects/{AMPLIFY_FIRESTORE_PROJECT}"
    "/databases/(default)/documents"
)
# Capital Group's holdings page (capitalgroup.com/.../holdings?etf=TICKER) is a
# client-rendered Next.js app with no data in the initial HTML — but the "Download"
# button behind it hits a plain, unauthenticated REST endpoint that returns an XLSX
# workbook directly, no browser required. Discovered via the app's Next.js rewrite
# rules (source: "/api/investment-service/:slug*") and confirmed live. See
# get_holdings_capitalgroup.
CAPITALGROUP_API_URL = "https://www.capitalgroup.com/api/investments/investment-service/v1/etfs"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

# Directory Structure
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "data")
RAW_DIR = os.path.join(DATA_DIR, "raw")
# DB Path
DB_PATH = os.path.join(DATA_DIR, "holdings.db")
LOG_FILE = os.path.join(SCRIPT_DIR, "scraper.log")
DASHBOARD_CSV = os.path.join(SCRIPT_DIR, "normalized_holdings.csv")

# Ensure directories exist
for d in [RAW_DIR]:
    os.makedirs(d, exist_ok=True)

# Column mapping for normalization
COLUMN_MAPPING = {
    'name': 'Name',
    'ticker': 'Ticker',
    'securityType': 'Security Type',
    'shareQuantity': 'Share Quantity',
    'baseMarketValue': 'Market Value',
    'weight': 'Weight',
    'sector': 'Sector',
    'country': 'Country',
    'cusip': 'CUSIP',
    'isin': 'ISIN',
    'sedol': 'SEDOL',
    'coupon': 'Coupon',
    'maturityDate': 'Maturity Date',
    'Description': 'Name',
    'Ticker': 'Ticker',
    'Quantity': 'Share Quantity',
    'Market Value': 'Market Value',
    '% of fund': 'Weight',
    'CUSIP': 'CUSIP',
    'StockTicker': 'Ticker',
    'SecurityName': 'Name',
    'Shares': 'Share Quantity',
    'MarketValue': 'Market Value',
    'Weightings': 'Weight',
    'Symbol': 'Ticker',
    'Shares Held': 'Share Quantity',
    'Net Value': 'Market Value',
    'Weighting': 'Weight',
    'Security Identifier': 'CUSIP',
    'fund': 'ETF Ticker',
    'company': 'Name',
    'shares': 'Share Quantity',
    'market value ($)': 'Market Value',
    'weight (%)': 'Weight',
    'Weight (%)': 'Weight',
    'Account': 'ETF Ticker',
    'Date': 'Date',
    'Stock Ticker': 'Ticker',
    'Security Name': 'Name',
}

def log(message):
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    formatted_msg = f"[{timestamp}] {message}"
    print(formatted_msg)
    with open(LOG_FILE, "a") as f:
        f.write(formatted_msg + "\n")

def parse_option(name, ticker):
    # The leading \d? absorbs the exchange-prefixed OCC roots that Kurv,
    # Roundhill, REX, YieldMax and NicholasX publish — "2MU   260918C00950000",
    # "4NDX  260918C02250000". Without it the root class ([A-Z]+) rejects them
    # and the leg falls through as an untyped equity row. That misfiled RDTE's
    # single largest position (45.8% of the fund) and 44.9% of QDTE.
    occ_regex = r'^\d?([A-Z]+)\s*(\d{2})(\d{2})(\d{2})([CP])(\d{8})$'
    desc_regex = r'^\d?([A-Z]+)\s+(\d{2}/\d{2}/\d{4})\s+(\d+(?:\.\d+)?)\s+([CP])$'
    
    clean_ticker = str(ticker).strip() if ticker else ''
    clean_name = str(name).strip() if name else ''
    
    # Try OCC Pattern
    match = re.match(occ_regex, clean_ticker)
    if match:
        underlying, yy, mm, dd, type_char, strike_str = match.groups()
        strike = float(strike_str) / 1000.0
        expiry = f"20{yy}-{mm}-{dd}"
        return {
            'underlying': underlying,
            'strike': strike,
            'expiry': expiry,
            'type': 'Call' if type_char == 'C' else 'Put'
        }
    
    # Try Descriptive Pattern
    match = re.match(desc_regex, clean_name)
    if match:
        underlying, expiry_str, strike_str, type_char = match.groups()
        try:
            expiry = datetime.datetime.strptime(expiry_str, '%m/%d/%Y').strftime('%Y-%m-%d')
            return {
                'underlying': underlying,
                'strike': float(strike_str),
                'expiry': expiry,
                'type': 'Call' if type_char == 'C' else 'Put'
            }
        except: pass
        
    # Relaxed fallback
    fallback_match = re.match(r'^([A-Z]+)\s+(\d{2}/\d{2}/\d{4})\s+(\d+(?:\.\d+)?)\s+([CP])(?:all|ut)?$', clean_name, re.I)
    if fallback_match:
        underlying, expiry_str, strike_str, type_char = fallback_match.groups()
        try:
            expiry = datetime.datetime.strptime(expiry_str, '%m/%d/%Y').strftime('%Y-%m-%d')
            return {
                'underlying': underlying,
                'strike': float(strike_str),
                'expiry': expiry,
                'type': 'Call' if type_char.upper().startswith('C') else 'Put'
            }
        except: pass

    # REX "US"-style descriptive name: e.g. "CLSK US 06/12/26 C16", "TE US 06/12/26 P7.5".
    # REX intermittently serves this format instead of the OCC option ticker; when it
    # does, the ticker column is blank and these legs used to fall through as untyped
    # "OTHER" equity rows, silently dropping ULTI's whole options book for the day.
    # Format: {UNDERLYING} US {MM/DD/YY} {C|P}{STRIKE}  (2-digit year, type fused to strike)
    # The optional leading digit and trailing " FLX" cover Roundhill's FLEX index
    # options ("4NDX US 09/18/26 C2250 FLX"), which otherwise fall through here too.
    rex_match = re.match(
        r'^\d?([A-Z]+)\s+US\s+(\d{2}/\d{2}/\d{2})\s+([CP])(\d+(?:\.\d+)?)(?:\s+FLX)?$',
        clean_name,
    )
    if rex_match:
        underlying, expiry_str, type_char, strike_str = rex_match.groups()
        try:
            expiry = datetime.datetime.strptime(expiry_str, '%m/%d/%y').strftime('%Y-%m-%d')
            return {
                'underlying': underlying,
                'strike': float(strike_str),
                'expiry': expiry,
                'type': 'Call' if type_char == 'C' else 'Put'
            }
        except: pass

    return None

def get_underlying_prices(tickers):
    if not tickers: return {}
    log(f"Fetching current prices for {len(tickers)} underlyings via yfinance...")
    prices = {}
    ticker_list = list(tickers)
    chunk_size = 50

    for i in range(0, len(ticker_list), chunk_size):
        chunk = ticker_list[i:i + chunk_size]
        try:
            data = yf.download(chunk, period="1d", interval="1m", progress=False)
            if not data.empty and 'Close' in data:
                for t in chunk:
                    try:
                        # enrich_with_analytics() runs per fund, so a single-underlying
                        # fund (MSTY->MSTR, TSLY->TSLA, RDTE->RUT ...) sends a
                        # one-element chunk. yfinance returns MultiIndex columns even
                        # then, so data['Close'] is a DataFrame and .iloc[-1] yields a
                        # Series — pd.isna() on it raises "truth value of a Series is
                        # ambiguous", which the bare except below swallowed. That left
                        # Underlying_Price and Moneyness blank on every option row of
                        # 13 of the 25 option funds. .squeeze() collapses the
                        # single-column frame back to a Series so .iloc[-1] is scalar.
                        close = data['Close']
                        price = close.squeeze().iloc[-1] if len(chunk) == 1 else close[t].iloc[-1]
                        if not pd.isna(price):
                            prices[t] = float(price)
                    except Exception:
                        continue
        except Exception as e:
            log(f"Warning: yfinance fetch failed for chunk: {e}")

        if i + chunk_size < len(ticker_list):
            time.sleep(2)  # Rate limit between chunks

    return prices

def enrich_with_analytics(df):
    if df is None or df.empty: return df
    
    today = datetime.date.today()
    
    # 1. Parse Options
    option_data = []
    underlyings_to_fetch = set()
    
    for _, row in df.iterrows():
        opt = parse_option(row.get('Name'), row.get('Ticker'))
        if opt:
            option_data.append(opt)
            underlyings_to_fetch.add(opt['underlying'])
        else:
            option_data.append(None)
            
    # 2. Fetch prices
    underlying_prices = get_underlying_prices(underlyings_to_fetch)
    
    # 3. Compute Metrics
    df['Underlying_Ticker'] = [o['underlying'] if o else None for o in option_data]
    df['Option_Strike'] = [o['strike'] if o else None for o in option_data]
    df['Option_Expiry'] = [o['expiry'] if o else None for o in option_data]
    df['Option_Type'] = [o['type'] if o else None for o in option_data]
    
    df['Underlying_Price'] = df['Underlying_Ticker'].map(underlying_prices)
    
    dtes = []
    moneyness = []
    
    for idx, (i, row) in enumerate(df.iterrows()):
        opt = option_data[idx]
        if opt and opt['expiry']:
            try:
                expiry_dt = datetime.datetime.strptime(opt['expiry'], '%Y-%m-%d').date()
                dte = (expiry_dt - today).days
                dtes.append(dte)
                
                up = underlying_prices.get(opt['underlying'])
                if up and opt['strike']:
                    # Simple moneyness: Price / Strike for Calls, Strike / Price for Puts?
                    # Or just Price / Strike - 1? Let's do (Price - Strike) / Strike
                    m = (up - opt['strike']) / opt['strike'] if opt['type'] == 'Call' else (opt['strike'] - up) / opt['strike']
                    moneyness.append(m)
                else:
                    moneyness.append(None)
            except:
                dtes.append(None)
                moneyness.append(None)
        else:
            dtes.append(None)
            moneyness.append(None)
            
    df['DTE'] = dtes
    df['Moneyness'] = moneyness
    
    return df

def get_holdings_avantis(fund_config):
    fund_id = fund_config['id']
    fund_ticker = fund_config['ticker']
    url = AVANTIS_BASE_URL_TEMPLATE.format(id=fund_id)
    log(f"Fetching data for {fund_ticker} from {url}...")
    headers = {'User-Agent': USER_AGENT}
    try:
        response = _http_get(url, headers=headers)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        log(f"Error fetching URL for {fund_ticker} (after retries): {e}")
        return None

    html = response.text
    soup = BeautifulSoup(html, 'html.parser')
    script_content = None
    for script in soup.find_all('script'):
        if script.string and 'ticker:' in script.string and 'shareQuantity:' in script.string:
            script_content = script.string
            break
    
    if not script_content:
        log(f"Could not find script tag with holdings data for {fund_ticker}.")
        return None

    pattern = r'\{name:"(?P<name>.*?)",ticker:"(?P<ticker>.*?)",securityType:"(?P<securityType>.*?)",.*?cusip:"(?P<cusip>.*?)",isin:"(?P<isin>.*?)",sedol:"(?P<sedol>.*?)",shareQuantity:"(?P<shareQuantity>.*?)",.*?baseMarketValue:"(?P<baseMarketValue>.*?)",weight:"(?P<weight>.*?)",coupon:"(?P<coupon>.*?)",maturityDate:"(?P<maturityDate>.*?)",sector:"(?P<sector>.*?)",country:"(?P<country>.*?)"\}'
    matches = re.finditer(pattern, script_content)
    holdings_list = []
    for match in matches:
        data = match.groupdict()
        holdings_list.append(data)
        
    if not holdings_list:
        log(f"No holdings extracted for {fund_ticker}.")
        return None
        
    return pd.DataFrame(holdings_list)

def get_holdings_csv(fund_config):
    url = fund_config['url']
    fund_ticker = fund_config['ticker']
    method = fund_config.get('method', 'get').lower()
    data = fund_config.get('data', None)
    log(f"Fetching CSV data for {fund_ticker} from {url}...")
    headers = {'User-Agent': USER_AGENT}
    try:
        if method == 'post':
            response = _http_post(url, headers=headers, data=data)
        else:
            response = _http_get(url, headers=headers)
        response.raise_for_status()
        content = response.content.decode('utf-8-sig')
        # Check for empty lines or weird formatting in some CSVs (like ULTY)
        # We strip surrounding whitespace and filter empty lines
        lines = [line.strip() for line in content.splitlines() if line.strip()]
        if not lines:
             return None
             
        # Check if the first line looks like a header (contains common header keywords)
        header_keywords = ['Ticker', 'Name', 'Date', 'Symbol', 'Weight', 'Quantity', 'Account']
        has_header = any(kw in lines[0] for kw in header_keywords)
        
        if has_header:
            df = pd.read_csv(io.StringIO("\n".join(lines)))
        else:
            # If no header, we might have a problem unless we know the format.
            # However, most seem to have headers but might have empty first lines.
            df = pd.read_csv(io.StringIO("\n".join(lines)))
            
        return df
    except Exception as e:
        log(f"Error processing CSV for {fund_ticker}: {e}")
        return None

# Global cache so we only download the Roundhill bulk CSV once per run
_roundhill_bulk_df = None

def get_holdings_roundhill(fund_config):
    """Download Roundhill's bulk holdings CSV and filter to just the target fund.
    
    Roundhill publishes ALL fund holdings in one CSV at:
    https://www.roundhillinvestments.com/assets/data/FilepointRoundhill.40RU.RU_Holdings_MMDDYYYY.csv
    We download it once, cache in memory, and filter by the Account column.
    """
    global _roundhill_bulk_df
    fund_ticker = fund_config['ticker']
    
    if _roundhill_bulk_df is None:
        # Try today first, then yesterday (CSV may lag by a day)
        for days_back in range(7):
            dt = datetime.date.today() - datetime.timedelta(days=days_back)
            date_str = dt.strftime('%m%d%Y')
            url = f"https://www.roundhillinvestments.com/assets/data/FilepointRoundhill.40RU.RU_Holdings_{date_str}.csv"
            log(f"Fetching Roundhill bulk CSV for {fund_ticker} ({dt.isoformat()})...")
            headers = {'User-Agent': USER_AGENT}
            try:
                response = _http_get(url, headers=headers)
                if response.status_code == 200:
                    content = response.content.decode('utf-8-sig')
                    # Check for soft 404 (HTML instead of CSV)
                    if '<html' in content.lower() or '<title>' in content.lower() or '<body' in content.lower():
                        log(f"Roundhill CSV returned HTML (Soft 404) for {date_str}, trying previous day...")
                        continue

                    lines = [line.strip() for line in content.splitlines() if line.strip()]
                    if lines:
                        _roundhill_bulk_df = pd.read_csv(io.StringIO("\n".join(lines)), on_bad_lines='skip')
                        log(f"Roundhill bulk CSV loaded: {len(_roundhill_bulk_df)} total rows from {date_str}")
                        break
                else:
                    log(f"Roundhill CSV not found for {date_str} (HTTP {response.status_code}), trying previous day...")
            except Exception as e:
                log(f"Error fetching Roundhill bulk CSV: {e}")
                continue
        
        if _roundhill_bulk_df is None:
            log(f"FAILED to fetch Roundhill bulk CSV after 7 attempts")
            return None
    
    # Filter to just this fund's rows
    if 'Account' in _roundhill_bulk_df.columns:
        fund_df = _roundhill_bulk_df[_roundhill_bulk_df['Account'] == fund_ticker].copy()
    else:
        log(f"Roundhill CSV missing 'Account' column, cannot filter for {fund_ticker}")
        return None
    
    if fund_df.empty:
        log(f"No rows found for {fund_ticker} in Roundhill bulk CSV")
        return None
    
    log(f"Filtered {len(fund_df)} rows for {fund_ticker} from Roundhill bulk CSV")
    return fund_df

def get_holdings_ishares(fund_config):
    url = fund_config['url']
    fund_ticker = fund_config['ticker']
    log(f"Fetching iShares CSV for {fund_ticker}...")
    headers = {'User-Agent': USER_AGENT}
    try:
        response = _http_get(url, headers=headers)
        response.raise_for_status()
        content = response.content.decode('utf-8-sig')
        
        # Skip metadata header (often starts with "Ticker,Name,..." or contains metadata before)
        # We find the line containing "Ticker" and "Name"
        lines = content.splitlines()
        header_idx = 0
        for i, line in enumerate(lines[:20]): # Check first 20 lines
            if "Ticker" in line and "Name" in line:
                header_idx = i
                break
        
        df = pd.read_csv(io.StringIO("\n".join(lines[header_idx:])))
        return df
    except Exception as e:
        log(f"Error processing iShares for {fund_ticker}: {e}")
        return None

def get_holdings_corgi(fund_config):
    """Fetch holdings from Corgi Funds JSON API.

    Corgi Funds exposes all portfolio data via a public AWS API Gateway:
    GET {CORGI_API_URL}?account={TICKER}&limit=1000
    Returns JSON with 'data' list containing stock_ticker, security_name,
    cusip, shares, market_value, weightings, account fields.
    """
    fund_ticker = fund_config['ticker']
    url = f"{CORGI_API_URL}?account={fund_ticker}&limit=1000"
    log(f"Fetching Corgi JSON API for {fund_ticker} from {url}...")
    headers = {'User-Agent': USER_AGENT, 'Accept': 'application/json'}
    try:
        response = _http_get(url, headers=headers)
        response.raise_for_status()
        json_data = response.json()
        data = json_data.get('data', [])
        if not data:
            log(f"No holdings data returned for {fund_ticker}")
            return None
        df = pd.DataFrame(data)
        # Rename API fields to standard normalized columns
        df = df.rename(columns={
            'stock_ticker':  'Ticker',
            'security_name': 'Name',
            'cusip':         'CUSIP',
            'shares':        'Share Quantity',
            'market_value':  'Market Value',
            'weightings':    'Weight',
            'account':       'ETF Ticker',
        })
        # The Corgi API returns the full historical time-series (one row per
        # ticker per day) rather than a single latest-snapshot. Without this
        # dedup, every (fund, ticker) combination appears N times in the daily
        # CSV — breaking cross-fund lookups like /api/v1/ticker/GOOGL. Keep
        # only the row with the most-recent holding_date per (fund, ticker).
        if 'holding_date' in df.columns and not df.empty:
            before = len(df)
            df = (df
                  .sort_values('holding_date', ascending=False)
                  .drop_duplicates(subset=['ETF Ticker', 'Ticker'], keep='first')
                  .reset_index(drop=True))
            if before != len(df):
                log(f"Corgi dedup: {before} → {len(df)} rows for {fund_ticker} "
                    f"(removed {before - len(df)} historical duplicates)")
        log(f"Corgi API returned {len(df)} holdings for {fund_ticker}")
        return df
    except Exception as e:
        log(f"Error fetching Corgi API for {fund_ticker}: {e}")
        return None


def get_holdings_sprott(fund_config):
    """Scrape holdings from a Sprott ETF page.

    Sprott embeds the full holdings CSV inline as a data:application/csv URI
    in the 'Download All Holdings' link. We fetch the page, extract the URI,
    URL-decode it, and parse the resulting CSV.
    Columns: Security, Market Value, Symbol, SEDOL, Quantity, Weight
    """
    url = fund_config['url']
    fund_ticker = fund_config['ticker']
    log(f"Fetching Sprott holdings page for {fund_ticker} from {url}...")
    headers = {'User-Agent': USER_AGENT}
    try:
        response = _http_get(url, headers=headers)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        log(f"Error fetching Sprott page for {fund_ticker} (after retries): {e}")
        return None

    html = response.text
    # Find the data:application/csv URI embedded in the page
    import urllib.parse
    csv_match = re.search(r'data:application/csv;charset=utf-8,([^"]+)', html)
    if not csv_match:
        log(f"Could not find inline CSV data for {fund_ticker} on Sprott page")
        return None

    csv_text = urllib.parse.unquote(csv_match.group(1))
    # The CSV uses \r\n line endings from the data URI
    lines = [line.strip() for line in csv_text.splitlines() if line.strip()]
    if not lines:
        log(f"Empty CSV data for {fund_ticker}")
        return None

    df = pd.read_csv(io.StringIO("\n".join(lines)))
    # Rename Sprott columns to our standard names
    df = df.rename(columns={
        'Security': 'Name',
        'Symbol': 'Ticker',
        'Market Value': 'Market Value',
        'Quantity': 'Share Quantity',
        'Weight': 'Weight',
        'SEDOL': 'SEDOL',
    })
    log(f"Sprott page returned {len(df)} holdings for {fund_ticker}")
    return df


def get_holdings_firsttrust(fund_config):
    """Scrape holdings from a First Trust ETF's holdings page.

    ftportfolios.com renders the full holdings grid server-side in the initial
    HTML as <table class="fundSilverGrid"> — despite an "Export to Excel" link
    that triggers an ASP.NET __doPostBack, no postback simulation is needed.
    Column header text varies slightly by fund (FTLS says "Market Value /
    Notional Value" instead of plain "Market Value") so columns are matched
    by position, not exact header text — EXCEPT the column count itself
    varies too: MMSC's table has no Classification/Sector column at all
    (6 columns: Name, Identifier, CUSIP, Shares, Market Value, Weighting),
    while every other fund confirmed here has 7 (Classification inserted
    before Shares). The header row's cell count is read per-page to pick the
    right layout instead of assuming a fixed 7 columns.

    Two First Trust-specific quirks are normalized here, before returning,
    so clean_data() (which only strips $/,/% and doesn't understand
    accounting-parens negatives) sees plain values:
      - Short positions (confirmed on FTLS, the long/short fund) use TWO
        different negative formats in the same row: Share Quantity has a
        leading minus ("-91,855") while Market Value uses accounting parens
        ("($626,451.10)"). The parens form is converted to a plain negative
        sign here — left alone, clean_data()'s to_numeric(errors='coerce')
        would silently turn it into 0 instead of a negative number.
      - Cash rows (Identifier like "$USD"/"$CAD") and futures/derivative rows
        (blank CUSIP, non-cash) are dropped — same convention as other
        providers' non-equity row filtering elsewhere in this pipeline.
    """
    ticker = fund_config['ticker']
    url = f"https://www.ftportfolios.com/Retail/Etf/EtfHoldings.aspx?Ticker={ticker}"
    log(f"Fetching First Trust holdings page for {ticker} from {url}...")
    headers = {'User-Agent': USER_AGENT}
    try:
        response = _http_get(url, headers=headers)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        log(f"Error fetching First Trust page for {ticker} (after retries): {e}")
        return None

    try:
        html = response.text
        soup = BeautifulSoup(html, 'html.parser')
        table = soup.find('table', class_='fundSilverGrid')
        if table is None:
            log(f"Could not find holdings table for {ticker} on First Trust page")
            return None

        rows = table.find_all('tr')
        if len(rows) < 2:
            log(f"First Trust holdings table for {ticker} has no data rows")
            return None

        # Determine layout from the header row's column count. Most funds
        # have 7 columns (Classification present); MMSC has 6 (no
        # Classification/Sector column at all).
        header_cell_count = len(rows[0].find_all('td'))
        has_classification = header_cell_count >= 7
        min_cols = 7 if has_classification else 6
        if header_cell_count not in (6, 7):
            log(f"Unexpected First Trust column count ({header_cell_count}) for {ticker}; "
                f"expected 6 or 7 — attempting best-effort parse anyway")

        records = []
        for tr in rows[1:]:  # skip header row
            cells = [td.get_text(strip=True) for td in tr.find_all('td')]
            if len(cells) < min_cols:
                continue
            if has_classification:
                name, identifier, cusip, classification, shares, market_value, weight = cells[:7]
            else:
                name, identifier, cusip, shares, market_value, weight = cells[:6]
                classification = ''

            # Cash rows: Identifier is "$USD"/"$CAD" — drop.
            if identifier.startswith('$'):
                continue
            # Futures/derivative rows: blank CUSIP and not a cash row — drop.
            if not cusip.strip():
                continue

            # "($X)" accounting-parens negative -> plain "-X" so clean_data()'s
            # numeric cleanup (strip $/,/%, then to_numeric) reads it correctly
            # instead of coercing it to 0.
            market_value = market_value.strip()
            if market_value.startswith('(') and market_value.endswith(')'):
                market_value = '-' + market_value[1:-1]

            records.append({
                'Name': name,
                'Ticker': identifier,
                'CUSIP': cusip,
                'Sector': classification,
                'Share Quantity': shares,
                'Market Value': market_value,
                'Weight': weight,
            })

        if not records:
            log(f"No holdings rows extracted for {ticker} after filtering cash/futures")
            return None

        df = pd.DataFrame(records)
        log(f"First Trust page returned {len(df)} holdings for {ticker}")
        return df
    except Exception as e:
        log(f"Error parsing First Trust page for {ticker}: {e}")
        return None


def _firestore_unwrap(value):
    """Convert a Firestore REST 'typed value' into a plain Python scalar/container.

    Firestore's REST API wraps every field in a type tag, e.g.
    {"stringValue": "..."} / {"integerValue": "10"} / {"doubleValue": 1.37} /
    {"arrayValue": {"values": [...]}} / {"mapValue": {"fields": {...}}}. This
    peels those wrappers off recursively so the holdings array becomes a list of
    plain dicts we can hand straight to pandas.
    """
    if not isinstance(value, dict):
        return value
    if 'stringValue' in value:  return value['stringValue']
    if 'integerValue' in value: return int(value['integerValue'])
    if 'doubleValue' in value:  return value['doubleValue']
    if 'booleanValue' in value: return value['booleanValue']
    if 'timestampValue' in value: return value['timestampValue']
    if 'nullValue' in value:    return None
    if 'mapValue' in value:
        return {k: _firestore_unwrap(v)
                for k, v in value['mapValue'].get('fields', {}).items()}
    if 'arrayValue' in value:
        return [_firestore_unwrap(v)
                for v in value['arrayValue'].get('values', [])]
    # Unknown wrapper (geoPoint, bytes, reference…): return the inner value as-is
    return next(iter(value.values()), None)


def get_holdings_amplify(fund_config):
    """Fetch holdings from Amplify ETFs' public Google Firestore data feed.

    Amplify's holdings pages render client-side from a public Firestore project
    (amplify-etfs-data-feed). Each fund stores one document per trading day at
    funds/{TICKER}/holdings/{YYYY-MM-DD}, whose `holdings` field is an array of
    position maps: StockTicker, SecurityName, CUSIP, Shares, MarketValue,
    Weightings ("1.37%"), Price, holding_type, money_market_flag.

    We hit the Firestore REST API directly, mirroring the browser: list the
    holdings subcollection ordered by document id descending to find the latest
    as-of date, then GET that document and flatten its holdings array. The
    StockTicker column carries Bloomberg-style exchange suffixes (e.g. "3350 JP")
    which the main() normalizer already strips.
    """
    fund_ticker = fund_config['ticker']
    headers = {'User-Agent': USER_AGENT, 'Accept': 'application/json'}

    # 1. Find the latest as-of document id (YYYY-MM-DD) for this fund.
    list_params = urllib.parse.urlencode({
        'key': AMPLIFY_FIRESTORE_KEY,
        'orderBy': '__name__ desc',
        'pageSize': 1,
        'mask.fieldPaths': 'asOfDate',
    }, quote_via=urllib.parse.quote)
    list_url = f"{AMPLIFY_FIRESTORE_BASE}/funds/{fund_ticker}/holdings?{list_params}"
    log(f"Fetching Amplify Firestore holdings index for {fund_ticker}...")
    try:
        resp = _http_get(list_url, headers=headers)
        resp.raise_for_status()
        docs = resp.json().get('documents', [])
    except Exception as e:
        log(f"Error listing Amplify holdings for {fund_ticker}: {e}")
        return None
    if not docs:
        log(f"No Amplify holdings documents found for {fund_ticker}")
        return None
    as_of_id = docs[0]['name'].split('/')[-1]

    # 2. Fetch the latest holdings document and flatten it.
    doc_url = (f"{AMPLIFY_FIRESTORE_BASE}/funds/{fund_ticker}/holdings/{as_of_id}"
               f"?key={AMPLIFY_FIRESTORE_KEY}")
    log(f"Fetching Amplify holdings for {fund_ticker} as of {as_of_id}...")
    try:
        resp = _http_get(doc_url, headers=headers)
        resp.raise_for_status()
        fields = resp.json().get('fields', {})
    except Exception as e:
        log(f"Error fetching Amplify holdings doc for {fund_ticker}: {e}")
        return None

    holdings = _firestore_unwrap(fields.get('holdings', {})) or []
    if not holdings:
        log(f"No holdings rows in Amplify document for {fund_ticker}")
        return None

    df = pd.DataFrame(holdings)
    log(f"Amplify Firestore returned {len(df)} holdings for {fund_ticker} (as of {as_of_id})")
    return df


def get_holdings_capitalgroup(fund_config):
    """Fetch holdings from Capital Group's public daily-holdings XLSX endpoint.

    Capital Group's holdings page renders client-side (Next.js, no data in the
    initial HTML — confirmed via curl and by inspecting the shipped JS bundles),
    but the "Download" button behind it calls a plain, unauthenticated REST
    endpoint that hands back an XLSX workbook directly:

        GET {CAPITALGROUP_API_URL}/{TICKER}/download/daily-holdings?audience=individual

    The workbook has two sheets: 'Disclosure' (boilerplate) and 'Daily Fund
    Holdings' (the data). The holdings sheet has no fixed header row — row 0
    carries fund name / as-of-date metadata, then a blank row, then the real
    header — so we scan for the row containing 'Security Name' and 'Ticker'
    rather than hardcoding an offset. Columns: Security Name, Ticker, Asset
    Type, Shares or Principal Amount, Market Value, Percent of Net Assets,
    CUSIP, ISIN, SEDOL 1, Notional Value. Cash/other lines (e.g. 'NET OTHER
    ASSETS', 'US DOLLAR') have no Ticker; main()'s generic OTHER/CASH fallback
    handles those like it does for every other provider.
    """
    fund_ticker = fund_config['ticker']
    url = f"{CAPITALGROUP_API_URL}/{fund_ticker}/download/daily-holdings?audience=individual"
    log(f"Fetching Capital Group daily holdings XLSX for {fund_ticker} from {url}...")
    headers = {'User-Agent': USER_AGENT}
    try:
        response = _http_get(url, headers=headers)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        log(f"Error fetching Capital Group XLSX for {fund_ticker} (after retries): {e}")
        return None

    try:
        raw = pd.read_excel(io.BytesIO(response.content), sheet_name='Daily Fund Holdings', header=None)
    except Exception as e:
        log(f"Error parsing Capital Group XLSX for {fund_ticker}: {e}")
        return None

    header_row_idx = None
    for i in range(min(10, len(raw))):
        row_vals = raw.iloc[i].astype(str).tolist()
        if 'Security Name' in row_vals and 'Ticker' in row_vals:
            header_row_idx = i
            break
    if header_row_idx is None:
        log(f"Could not find header row in Capital Group XLSX for {fund_ticker}")
        return None

    df = raw.iloc[header_row_idx + 1:].copy()
    df.columns = raw.iloc[header_row_idx]
    df = df.dropna(how='all')

    df = df.rename(columns={
        'Security Name': 'Name',
        'Asset Type': 'Security Type',
        'Shares or Principal Amount': 'Share Quantity',
        'Percent of Net Assets': 'Weight',
        'SEDOL 1': 'SEDOL',
    })

    log(f"Capital Group XLSX returned {len(df)} holdings for {fund_ticker}")
    return df


def normalize_columns(df):
    if df is None or df.empty: return df
    df = df.rename(columns=COLUMN_MAPPING)
    # Handle duplicate columns by taking the first one (e.g. if 'ticker' and 'Ticker' both existed)
    df = df.loc[:, ~df.columns.duplicated()]
    return df

def clean_data(df):
    if df is None or df.empty: return df
    
    # Strip column names to avoid trailing spaces causing issues
    df.columns = df.columns.str.strip()
    
    for col in ['Weight', 'Market Value', 'Share Quantity']:
        if col in df.columns:
            # Unconditionally cast to string to strip formatting characters (handles both object and string dtypes)
            df[col] = df[col].astype(str)\
                .str.replace('%', '', regex=False)\
                .str.replace('$', '', regex=False)\
                .str.replace(',', '', regex=False)
            df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)
            
    # Recalculate Weight with high precision if Market Value is available
    if 'Market Value' in df.columns and df['Market Value'].sum() > 0:
        df['Weight'] = (df['Market Value'] / df['Market Value'].sum()) * 100
            
    # Standardize Date to YYYY-MM-DD
    if 'Date' in df.columns:
        try:
            # Try parsing various formats
            df['Date'] = pd.to_datetime(df['Date']).dt.strftime('%Y-%m-%d')
        except Exception as e:
            log(f"Warning: Could not standardize date format: {e}")
            
    return df

def save_to_db(df):
    if df is None or df.empty: return
    conn = sqlite3.connect(DB_PATH)
    # Map DataFrame columns to SQL column names (Share Quantity -> Share_Quantity etc)
    df_db = df.copy()
    df_db.columns = [c.replace(' ', '_') for c in df_db.columns]
    
    # Only keep columns that exist in the DB schema
    valid_cols = [
        'Date', 'ETF_Ticker', 'Name', 'Ticker', 'Weight', 
        'Share_Quantity', 'Market_Value', 'Security_Type', 
        'CUSIP', 'ISIN', 'SEDOL', 'Sector', 'Country',
        'Underlying_Ticker', 'Option_Strike', 'Option_Expiry',
        'Option_Type', 'DTE', 'Underlying_Price', 'Moneyness'
    ]
    df_db = df_db[[c for c in valid_cols if c in df_db.columns]]
    
    # Drop duplicates to prevent IntegrityError
    before_count = len(df_db)
    df_db = df_db.drop_duplicates(subset=['Date', 'ETF_Ticker', 'Ticker'])
    after_count = len(df_db)
    if before_count != after_count:
        log(f"Dropped {before_count - after_count} duplicate rows from insertion.")

    try:
        # 1. Save to temporary table first to handle conflicts gracefully
        df_db.to_sql('TempHoldings', conn, if_exists='replace', index=False)
        
        # 2. Use SQL to Insert or Replace into the main Holdings table
        # This ensures that if we rerun the scraper, it updates existing records instead of failing
        cols_str = ", ".join(df_db.columns)
        placeholders = ", ".join(["?" for _ in df_db.columns])
        
        insert_query = f"INSERT OR REPLACE INTO Holdings ({cols_str}) SELECT {cols_str} FROM TempHoldings"
        conn.execute(insert_query)
        
        # 3. Drop temp table
        conn.execute("DROP TABLE TempHoldings")
        
        conn.commit()
        log(f"Successfully saved {len(df_db)} records to SQLite (idempotent).")
    except Exception as e:
        log(f"Error saving to DB: {e}")
    finally:
        conn.close()

def generate_changes_sql(today):
    conn = sqlite3.connect(DB_PATH)
    
    # Find most recent date before today
    prev_date_row = conn.execute("SELECT MAX(Date) FROM Holdings WHERE Date < ?", (today,)).fetchone()
    prev_date = prev_date_row[0] if prev_date_row else None
    
    if not prev_date:
        log("No previous data found in DB for change tracking.")
        conn.close()
        return

    log(f"Comparing current data with {prev_date} via SQL...")
    
    # Clear existing changes for today if any (idempotency)
    conn.execute("DELETE FROM DailyChanges WHERE Date = ?", (today,))
    
    # Use parameterized queries — no f-string interpolation of dates into SQL
    query = """
    INSERT INTO DailyChanges (Date, ETF_Ticker, Ticker, Name, Prev_Quantity, New_Quantity, Qty_Delta, Weight_Delta)
    SELECT * FROM (
        -- Current holdings LEFT JOIN previous: catches NEW and CHANGED
        SELECT 
            ? as Date,
            curr.ETF_Ticker,
            curr.Ticker,
            curr.Name,
            COALESCE(prev.Share_Quantity, 0) as Prev_Quantity,
            curr.Share_Quantity as New_Quantity,
            curr.Share_Quantity - COALESCE(prev.Share_Quantity, 0) as Qty_Delta,
            curr.Weight - COALESCE(prev.Weight, 0) as Weight_Delta
        FROM 
            (SELECT * FROM Holdings WHERE Date = ?) curr
        LEFT JOIN 
            (SELECT * FROM Holdings WHERE Date = ?) prev
        ON curr.ETF_Ticker = prev.ETF_Ticker AND curr.Ticker = prev.Ticker
        WHERE ABS(curr.Share_Quantity - COALESCE(prev.Share_Quantity, 0)) > 0 
           OR ABS(curr.Weight - COALESCE(prev.Weight, 0)) > 0.0001

        UNION ALL

        -- Previous holdings LEFT JOIN current (where current is NULL): catches REMOVED
        SELECT 
            ? as Date,
            prev.ETF_Ticker,
            prev.Ticker,
            prev.Name,
            prev.Share_Quantity as Prev_Quantity,
            0 as New_Quantity,
            -prev.Share_Quantity as Qty_Delta,
            -prev.Weight as Weight_Delta
        FROM 
            (SELECT * FROM Holdings WHERE Date = ?) prev
        LEFT JOIN 
            (SELECT * FROM Holdings WHERE Date = ?) curr
        ON prev.ETF_Ticker = curr.ETF_Ticker AND prev.Ticker = curr.Ticker
        WHERE curr.Ticker IS NULL
    )
    """
    
    try:
        conn.execute(query, (today, today, prev_date, today, prev_date, today))
        conn.commit()
        count = conn.execute("SELECT COUNT(*) FROM DailyChanges WHERE Date = ?", (today,)).fetchone()[0]
        log(f"Generated {count} changes in DB for {today}.")
    except Exception as e:
        log(f"Error generating changes via SQL: {e}")
        
    conn.close()

def cleanup_old_records():
    log("Running data retention sweep...")
    conn = sqlite3.connect(DB_PATH)
    try:
        # Keep raw holdings for 30 days
        expiry_date = (datetime.date.today() - datetime.timedelta(days=30)).isoformat()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM Holdings WHERE Date < ?", (expiry_date,))
        deleted_holdings = cursor.rowcount
        
        # Keep changes for 365 days
        expiry_changes = (datetime.date.today() - datetime.timedelta(days=365)).isoformat()
        cursor.execute("DELETE FROM DailyChanges WHERE Date < ?", (expiry_changes,))
        deleted_changes = cursor.rowcount
        
        log(f"Cleaned up {deleted_holdings} old holdings and {deleted_changes} old changes.")
        conn.commit()
    except Exception as e:
        log(f"Error during cleanup: {e}")
    finally:
        conn.close()
    
    # Run VACUUM in a separate non-transaction connection
    try:
        conn_vac = sqlite3.connect(DB_PATH)
        conn_vac.execute("VACUUM")
        conn_vac.close()
    except Exception as vacuum_e:
        log(f"Vacuum warning: {vacuum_e}")

def main():
    # Ensure DB is setup correctly
    setup_database()
    
    # Initialize CUSIP→ticker resolver (seeds from existing data)
    global cusip_resolver
    cusip_resolver = CusipLookup()
    log(f"CUSIP lookup ready: {cusip_resolver.stats()['cached_mappings']} cached mappings")
    
    today = datetime.date.today().isoformat()
    log(f"--- Starting Daily Scrape: {today} ---")
    all_holdings = []
    
    failed_funds = []
    
    for fund in FUNDS:
        ticker = fund['ticker']
        df = None
        try:
            if fund['type'] == 'avantis':
                df = get_holdings_avantis(fund)
            elif fund['type'] == 'ishares':
                df = get_holdings_ishares(fund)
            elif fund['type'] == 'roundhill':
                df = get_holdings_roundhill(fund)
            elif fund['type'] == 'corgi':
                df = get_holdings_corgi(fund)
            elif fund['type'] == 'sprott':
                df = get_holdings_sprott(fund)
            elif fund['type'] == 'amplify':
                df = get_holdings_amplify(fund)
            elif fund['type'] == 'capitalgroup':
                df = get_holdings_capitalgroup(fund)
            elif fund['type'] == 'firsttrust':
                df = get_holdings_firsttrust(fund)
            else:
                df = get_holdings_csv(fund)
        except Exception as e:
            log(f"CRITICAL ERROR for {ticker}: {e}")
            failed_funds.append(ticker)
            continue
        
        if df is not None:
            log(f"Extracted {len(df)} rows for {ticker}")
            df = normalize_columns(df)
            # Always set ETF Ticker to our config ticker (source CSVs may use different names like REX_ULTI)
            df['ETF Ticker'] = ticker
            
            if 'Ticker' in df.columns:
                df['Ticker'] = df['Ticker'].astype(str).str.strip().replace('nan', '')
                # Strip Bloomberg exchange suffixes (e.g. "RKLB UQ" → "RKLB", "NU UN" → "NU")
                # ARK fund CSVs use Bloomberg-style tickers with exchange codes appended
                BLOOMBERG_SUFFIXES = r'\s+(?:UQ|UN|UW|UP|UA|FP|LN|GY|SJ|AU|CT|CN|JP|HK|SW|SS|IT|SM|NA|BB|PL|DC|NO|AV|ID|MK|TB|PM|IJ)$'
                df['Ticker'] = df['Ticker'].str.replace(BLOOMBERG_SUFFIXES, '', regex=True)
                mask = (df['Ticker'] == '') | (df['Ticker'].isnull())
                if mask.any():
                    df.loc[mask, 'Ticker'] = df.loc[mask, 'Name'].apply(lambda x: 'CASH' if 'CASH' in str(x).upper() or 'GOVT' in str(x).upper() else 'OTHER')
            
            # CUSIP lookup: resolve 'OTHER' tickers using CUSIP→ticker mapping
            if 'Ticker' in df.columns and 'CUSIP' in df.columns:
                other_mask = df['Ticker'] == 'OTHER'
                if other_mask.any():
                    cusips_to_resolve = df.loc[other_mask, 'CUSIP'].dropna().unique().tolist()
                    cusips_to_resolve = [c for c in cusips_to_resolve if c.strip()]
                    if cusips_to_resolve:
                        resolved = cusip_resolver.resolve_batch(cusips_to_resolve)
                        if resolved:
                            for idx in df[other_mask].index:
                                cusip = str(df.at[idx, 'CUSIP']).strip()
                                if cusip in resolved:
                                    df.at[idx, 'Ticker'] = resolved[cusip]
                            resolved_count = sum(1 for c in cusips_to_resolve if c in resolved)
                            log(f"CUSIP lookup resolved {resolved_count}/{len(cusips_to_resolve)} tickers for {ticker}")
            
            # Filter out disclaimers (e.g. iShares puts disclaimers in the Ticker column)
            if 'Ticker' in df.columns:
                df = df[df['Ticker'].astype(str).str.len() < 30]
            
            if 'Name' in df.columns:
                df = df.dropna(subset=['Name'])
                
            if 'Date' not in df.columns:
                df['Date'] = today
                
            df = clean_data(df)
            # Enrich with option analytics and real-time prices
            df = enrich_with_analytics(df)
            
            raw_date_dir = os.path.join(RAW_DIR, today)
            os.makedirs(raw_date_dir, exist_ok=True)
            df.to_csv(os.path.join(raw_date_dir, f"{ticker}_{today}.csv"), index=False)
            
            all_holdings.append(df)
        else:
            log(f"FAILED to extract data for {ticker}")
            failed_funds.append(ticker)
        time.sleep(1)
    
    if all_holdings:
        final_df = pd.concat(all_holdings, ignore_index=True)
        
        # 1. Save to SQLite
        save_to_db(final_df)
        
        # 2. Generate Changes in DB
        generate_changes_sql(today)
        
        # 3. Cleanup Old Data
        cleanup_old_records()
        
        # 4. Update Dashboard Source
        final_df.to_csv(DASHBOARD_CSV, index=False)
        log(f"Updated global dashboard file: {DASHBOARD_CSV}")
        
    else:
        log("No data collected today.")
        if failed_funds:
            log(f"Process failed for: {failed_funds}")
            sys.exit(1)
    
    if failed_funds:
        log(f"Scrape completed with {len(failed_funds)} failures: {failed_funds}")
        failure_rate = len(failed_funds) / len(FUNDS)
        if failure_rate > 0.25:
            log(f"CRITICAL: {len(failed_funds)}/{len(FUNDS)} funds failed ({failure_rate:.0%}). Aborting to protect data integrity.")
            sys.exit(1)
        else:
            log(f"WARNING: {len(failed_funds)} fund(s) failed but within acceptable range. Committing available data.")
        
    log("--- Scrape Complete ---")

if __name__ == "__main__":
    main()

