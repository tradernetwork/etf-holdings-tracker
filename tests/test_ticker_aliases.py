"""Same-company ticker aliases (SMSN / A005930 / SKHY ...). See _TICKER_ALIASES."""
import csv
import math

import pytest

from api import data

HEADER = ["Name", "Ticker", "Share Quantity", "Market Value", "Weight", "ETF Ticker",
          "Sector", "Option_Type"]


def _write(path, rows):
    with open(path, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(HEADER)
        for name, tk, sh, mv, wt, fund in rows:
            w.writerow([name, tk, sh, mv, wt, fund, "", ""])


def _day(skhy_w=1.9, a660_w=2.2, other_w=10.0, smsn_w=5.0):
    return [
        ("SAMSUNG ELECTR GDR REG S GDR", "SMSN", 335196, 1_400_000_000, smsn_w, "AVEM"),
        ("SK HYNIX INC COMMON STOCK KRW5000.0", "A000660", 140274, 148_000_000, a660_w, "CGXU"),
        ("SK HYNIX INC ADR ADR", "SKHY", 854596, 126_000_000, skhy_w, "CGXU"),
        ("SAMSUNG ELECTRONICS CO LTD COMMON STOCK KRW100.0", "A005930", 1049636, 200_000_000, 2.7, "CGXU"),
        ("APPLE INC", "AAPL", 1000, 200_000, other_w, "CGXU"),
        ("Samsung Electronics Co., Ltd.", "005930.KS", 9054, 5_000_000, 4.1, "WCME"),
        ("SAMSUNG ELECTRONICS CO LTD PREF", "A005935", 100, 1000, 0.1, "DRAM"),
    ]


@pytest.fixture
def rows(tmp_path):
    p = tmp_path / "h.csv"
    _write(p, _day())
    return data._read_csv_uncached(str(p))


def _by(rows):
    return {(r["ETF Ticker"], r["Ticker"]): r for r in rows}


def test_samsung_variants_share_one_ticker(rows):
    m = _by(rows)
    assert ("AVEM", "A005930") in m and ("WCME", "A005930") in m and ("CGXU", "A005930") in m
    assert not any(t in ("SMSN", "005930.KS") for _, t in m)


def test_full_company_name_replaces_truncated(rows):
    m = _by(rows)
    assert m[("AVEM", "A005930")]["Name"] == "Samsung Electronics Co Ltd"
    assert m[("CGXU", "A000660")]["Name"] == "SK Hynix Inc"


def test_preferred_shares_not_aliased(rows):
    assert ("DRAM", "A005935") in _by(rows)


def test_fund_holding_both_lines_is_merged_once(rows):
    cg = [r for r in rows if r["ETF Ticker"] == "CGXU" and r["Ticker"] == "A000660"]
    assert len(cg) == 1
    r = cg[0]
    assert math.isclose(float(r["Weight"]), 1.9 + 2.2)
    assert math.isclose(float(r["Market Value"]), 148_000_000 + 126_000_000)
    # share count / price stay the KRX line's: ADR units are not comparable
    assert float(r["Share Quantity"]) == 140274


def test_clean_ticker_resolves_aliases():
    assert data._clean_ticker("SMSN") == "A005930"
    assert data._clean_ticker(" 005930.KS ") == "A005930"
    assert data._clean_ticker("AAPL") == "AAPL"


def test_option_rows_never_aliased():
    seen = {("X", "SMSN"): {"Ticker": "SMSN", "Option_Type": "C", "Weight": "1"}}
    data._apply_ticker_aliases(seen)
    assert ("X", "SMSN") in seen


def test_active_weight_zero_sum_survives_merge(tmp_path):
    prev_p, curr_p = tmp_path / "p.csv", tmp_path / "c.csv"
    _write(prev_p, _day())
    _write(curr_p, _day(skhy_w=2.4, a660_w=2.3, other_w=9.4))
    curr = data._build_map(data._read_csv_uncached(str(curr_p)))
    prev = data._build_map(data._read_csv_uncached(str(prev_p)))
    deltas = data._active_weight_deltas(curr, prev)
    cg = {k: v for k, v in deltas.items() if k[0] == "CGXU"}
    assert ("CGXU", "A000660") in cg and ("CGXU", "SKHY") not in cg
    assert abs(sum(cg.values())) < 1e-6


def test_implausible_price_ratio_is_neutralised_not_emitted():
    """AVIV IAG 2026-10: shares 1,333,518 -> 25,381, weight 0.364 -> 0.186, no
    recognisable split => implied price ~26x. Must not emit a fake -8.77pp."""
    def book(iag_sh, iag_w, iag_mv, other_w):
        return data._build_map([
            {"Ticker": t, "ETF Ticker": "AVIV", "Name": t, "Share Quantity": str(sh),
             "Market Value": str(mv), "Weight": str(w)}
            for t, sh, mv, w in [("IAG", iag_sh, iag_mv, iag_w), ("AAA", 1000, 1_000_000, other_w)]])
    prev = book(1_333_518, 0.364, 10_000_000, 99.636)
    curr = book(25_381, 0.186, 4_900_000, 99.814)
    deltas = data._active_weight_deltas(curr, prev)
    assert deltas[("AVIV", "IAG")] == 0.0
    assert abs(deltas[("AVIV", "AAA")]) < 0.2
