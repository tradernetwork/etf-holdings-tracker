"""VanEck WARP (XLSX behind a cookie redirect) and Tuttle FOTO (Navstar JSON, swap-heavy)."""
import io
import re
from pathlib import Path

import openpyxl
import pytest

import scrape_avantis
from api.data import FUND_AUM, FUND_PROVIDERS, get_fund_category

PROVIDERS_TS = Path(__file__).resolve().parent.parent / "etf-dashboard" / "lib" / "providers.ts"


def _warp_xlsx() -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Daily Holdings (%)  11/03/2026"])
    ws.append([""])
    ws.append(["Number", "Ticker", "Holding Name", "Identifier (FIGI)", "Shares", "Asset Class",
               "Market Value (US$)", "Notional Value", "% of Net Assets"])
    ws.append([1, "RKLB", "Rocket Lab Corp", "BBG01V7JN3F3", "89,379", "Stock", "$4,864,898.97", " -- ", "12.87%"])
    ws.append([2, "SESG FP", "Ses Sa", "BBG000GXK7D7", "237,238", "Stock", "$1,097,891.28", " -- ", "2.90%"])
    ws.append([3, "9412 JP", "Sky Perfect Jsat", "BBG000HQJM04", "117,900", "Stock", "$1,323,425.73", " -- ", "3.50%"])
    ws.append([4, "-USD CASH-", "", " ", "68,309", "Cash Bal", "$68,308.63", " -- ", "0.18%"])
    ws.append([5, " -- ", "Other/Cash", " -- ", " -- ", "Cash", "$21,267.19", " -- ", "0.06%"])
    ws.append(["These are not recommendations to buy or to sell any security."])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


class _Resp:
    def __init__(self, content=b"", payload=None, status=200):
        self.content, self._payload, self.status_code = content, payload, status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise scrape_avantis.requests.exceptions.HTTPError(str(self.status_code))

    def json(self):
        return self._payload


def test_vaneck_keeps_stock_rows_only_and_strips_exchange_codes(monkeypatch):
    monkeypatch.setattr(scrape_avantis, "_vaneck_get", lambda *a, **k: _Resp(_warp_xlsx()))
    df = scrape_avantis.get_holdings_vaneck({"ticker": "WARP", "type": "vaneck"})
    assert list(df["Ticker"]) == ["RKLB", "SESG", "9412"]  # cash + footer dropped, suffixes stripped
    out = scrape_avantis.process_fund_frame(df, "WARP", "2026-11-04")
    assert set(out["Date"]) == {"2026-11-03"}
    rklb = out[out["Ticker"] == "RKLB"].iloc[0]
    assert rklb["Share Quantity"] == 89379 and rklb["Market Value"] == pytest.approx(4864898.97)
    assert out["Weight"].sum() == pytest.approx(100)


def test_vaneck_html_instead_of_xlsx_returns_none(monkeypatch):
    monkeypatch.setattr(scrape_avantis, "_vaneck_get", lambda *a, **k: _Resp(b"<html>home</html>"))
    assert scrape_avantis.get_holdings_vaneck({"ticker": "WARP", "type": "vaneck"}) is None


def _row(name, tkr, w, mv, q):
    return {"security_name": name, "security_ticker": tkr, "weight": w, "market_value": mv,
            "quantity": q, "as_of_date": "2026-11-03"}


FOTO_FEED = {"holdings": [
    _row("CASH AND CASH EQUIVALENTS", None, 93.98, 86592808.51, 86592808.51),
    _row("RECV FOTO TRS LITE EQ", None, 11.43, 10535678.4, 15490),
    _row("LUMENTUM HOLDINGS INC", "LITE", 7.43, 6850000.0, 10073),
    _row("PAYB FOTO TRS LITE EQ", None, -14.31, -13190823.95, -13190823.95),
    _row("RECV FOTO TRS LWLG EQ", None, 1.21, 1100000.0, 239876),  # swap with no direct row
    _row("POET TECHNOLOGIES INC COMMON STOCK", "POET US", 1.38, 1274128.8, 250320),
]}


def test_tuttle_folds_recv_swaps_and_drops_payables_and_cash(monkeypatch):
    monkeypatch.setattr(scrape_avantis, "_http_get", lambda *a, **k: _Resp(payload=FOTO_FEED))
    df = scrape_avantis.get_holdings_tuttle({"ticker": "FOTO", "type": "tuttle"})
    by = df.set_index("Ticker")
    assert set(by.index) == {"LITE", "LWLG", "POET"}  # no cash, no PAYB, "POET US" suffix stripped
    assert by.loc["LITE", "Share Quantity"] == 10073 + 15490
    assert by.loc["LITE", "Market Value"] == pytest.approx(6850000.0 + 10535678.4)
    assert by.loc["LITE", "Name"] == "LUMENTUM HOLDINGS INC"  # direct row keeps its name
    assert (by["Market Value"] > 0).all()
    out = scrape_avantis.process_fund_frame(df, "FOTO", "2026-11-04")
    assert out["Weight"].sum() == pytest.approx(100) and (out["Weight"] > 0).all()


def test_tuttle_empty_or_bad_feed_returns_none(monkeypatch):
    monkeypatch.setattr(scrape_avantis, "_http_get", lambda *a, **k: _Resp(payload={"holdings": []}))
    assert scrape_avantis.get_holdings_tuttle({"ticker": "FOTO", "type": "tuttle"}) is None


@pytest.mark.parametrize("fund,provider,kind", [("WARP", "VanEck", "vaneck"), ("FOTO", "Tuttle Capital", "tuttle")])
def test_fund_is_registered_everywhere(fund, provider, kind):
    cfg = [f for f in scrape_avantis.FUNDS if f["ticker"] == fund]
    assert len(cfg) == 1 and cfg[0]["type"] == kind
    assert FUND_PROVIDERS[fund] == provider and fund in FUND_AUM
    assert get_fund_category(fund) == "active-equity"
    ts = PROVIDERS_TS.read_text(encoding="utf-8")
    assert re.search(rf"\b{fund}: '{provider}'", ts) and f"'{provider}'," in ts.split("PROVIDER_ORDER")[1]
