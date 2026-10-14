"""Global X full-holdings CSV: two title lines, header, rows, trailing disclaimer."""
import re
from pathlib import Path

import pytest

import scrape_avantis
from api.data import FUND_PROVIDERS, get_fund_category

SAMPLE = '''Global X Nasdaq 100 Covered Call ETF
Fund Holdings Data as of 10/13/2026
% of Net Assets,Ticker,Name,SEDOL,Market Price ($),Shares Held,Market Value ($)
8.63,NVDA,NVIDIA CORP,2379504,228.52,"3,224,823.00","736,936,551.96"
0.01,"",CASH,"",1.0,"786,539.13","786,539.13"
-3.75,"",NDX US 10/16/26 C29475,"",111470.0,"-2,870.00","-319,918,900.00"
"The information contained herein may not be reproduced."
'''
GLOBALX = "QYLD XYLD RYLD QRMI XRMI QYLG XYLG DJIA".split()
PROVIDERS_TS = Path(__file__).resolve().parent.parent / "etf-dashboard" / "lib" / "providers.ts"


class _Resp:
    status_code = 200
    content = SAMPLE.encode()


def test_globalx_parser_reads_rows_date_and_short_call(monkeypatch):
    monkeypatch.setattr(scrape_avantis, "_http_get", lambda *a, **k: _Resp())
    df = scrape_avantis.get_holdings_globalx({"ticker": "QYLD", "type": "globalx"})
    assert len(df) == 3  # disclaimer row dropped
    assert set(df["Date"]) == {"10/13/2026"}
    out = scrape_avantis.process_fund_frame(df, "QYLD", "2026-10-14")
    call = out[out["Option_Type"].notna()].iloc[0]
    assert call["Option_Type"] == "Call" and call["Underlying_Ticker"] == "NDX"
    assert call["Share Quantity"] == -2870  # written (short)


def test_globalx_unexpected_layout_returns_none(monkeypatch):
    class Bad(_Resp):
        content = b"<html>nope</html>\nx\ny\nz\n"
    monkeypatch.setattr(scrape_avantis, "_http_get", lambda *a, **k: Bad())
    assert scrape_avantis.get_holdings_globalx({"ticker": "QYLD", "type": "globalx"}) is None


@pytest.mark.parametrize("fund", GLOBALX)
def test_globalx_fund_is_registered_everywhere(fund):
    cfg = [f for f in scrape_avantis.FUNDS if f["ticker"] == fund]
    assert len(cfg) == 1 and cfg[0]["type"] == "globalx"
    assert FUND_PROVIDERS[fund] == "Global X"
    assert get_fund_category(fund) == "option-income"
    assert re.search(rf"\b{fund}: 'Global X'", PROVIDERS_TS.read_text(encoding="utf-8"))
