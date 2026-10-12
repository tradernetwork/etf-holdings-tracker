#!/usr/bin/env python3
"""
scripts/discord_briefing.py — Daily institutional briefing → Discord webhook.

Fetches today's top buys/sells/sector flow from the live API and posts a
formatted embed to a Discord webhook URL.

Usage:
    python3 scripts/discord_briefing.py <webhook_url>

Or via environment variable (preferred for cron):
    DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/... python3 scripts/discord_briefing.py

Design notes:
- Gold left-border embed (0xE0B03A = 14729274) per the Channels mock.
- Footer: "TickerTrace · A TraderMatrix product · tickertrace.pro"
- TickerTrace never posts flow data. The CTA only points at TraderMatrix:
    "Check whether the options tape agreed: https://www.tradermatrix.pro/?ref=MPHINANCE"
- The ref code ?ref=MPHINANCE must appear in every CTA, never as bare ?ref= or UTM params.
"""

import datetime
import json
import os
import sys
import urllib.request
import urllib.error
from typing import Any

API_BASE = "https://api.tickertrace.pro"
TM_REF_URL = "https://www.tradermatrix.pro/?ref=MPHINANCE"
# Gold left-border colour per the Channels mock — load-bearing, do not change
EMBED_COLOR = 0xE0B03A  # 14729274 decimal


def _get(path: str) -> Any:
    """Fetch JSON from the public TickerTrace API (no auth required)."""
    url = f"{API_BASE}{path}"
    req = urllib.request.Request(url, headers={"User-Agent": "TickerTrace-briefing/1.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode())


def _fmt_signal(sig: dict, direction: str) -> str:
    """One Discord markdown line per signal: **TICKER** ±X.XX% (N fam, 🔥Nd)"""
    ticker = sig.get("ticker", "?")
    delta = sig.get("totalWeightDelta", sig.get("weightDelta", 0))
    sign = "+" if delta > 0 else ""
    provider_count = sig.get("providerCount", 1)
    streak = sig.get("streak")

    parts = [f"**{ticker}** {sign}{delta:.2f}%"]
    meta = []
    if provider_count and provider_count > 1:
        meta.append(f"{provider_count} fam")
    if streak and abs(streak) >= 2:
        days = abs(streak)
        meta.append(f"🔥{days}d" if direction == "buying" else f"▼{days}d")
    if meta:
        parts.append(f"({', '.join(meta)})")
    return " · ".join(parts) if len(parts) > 1 else parts[0]


def _fmt_sectors(sector_flow: dict) -> str:
    inflows = sector_flow.get("inflows", [])[:3]
    outflows = sector_flow.get("outflows", [])[:3]
    lines = []
    if inflows:
        lines.append("▲ " + " · ".join(
            f"{s['sector']} +{s['delta']:.2f}%" for s in inflows
        ))
    if outflows:
        lines.append("▼ " + " · ".join(
            f"{s['sector']} {s['delta']:.2f}%" for s in outflows
        ))
    return "\n".join(lines) or "_No sector movement_"


def _build_payload(briefing: dict, sector_flow: dict) -> dict:
    top_buys = briefing.get("topBuys", [])[:5]
    top_sells = briefing.get("topSells", [])[:5]
    as_of = briefing.get("asOfDate") or ""

    tm_block = f"Did the options tape agree with today's buys? → see it on TraderMatrix: {TM_REF_URL}"

    buys_text = (
        "\n".join(_fmt_signal(s, "buying") for s in top_buys) or "_No significant buys_"
    )
    sells_text = (
        "\n".join(_fmt_signal(s, "selling") for s in top_sells) or "_No significant sells_"
    )
    sectors_text = _fmt_sectors(sector_flow)
    try:
        day = datetime.date.fromisoformat(as_of)
    except ValueError:
        day = datetime.datetime.utcnow().date()
    date_label = f"{day:%b} {day.day}"

    return {
        "username": "TickerTrace",
        "avatar_url": "https://tickertrace.pro/icon-192.png",
        "embeds": [
            {
                "title": f"TickerTrace · {date_label} briefing",
                "url": "https://tickertrace.pro/dashboard",
                # Gold left border (0xE0B03A) per the Channels mock
                "color": EMBED_COLOR,
                "fields": [
                    {
                        "name": "🟢 Top buys",
                        "value": buys_text,
                        "inline": False,
                    },
                    {
                        "name": "🔴 Top sells",
                        "value": sells_text,
                        "inline": False,
                    },
                    {
                        "name": "📊 Sector flow",
                        "value": sectors_text,
                        "inline": False,
                    },
                    {
                        "name": "⚡ Options tape",
                        "value": tm_block,
                        "inline": False,
                    },
                ],
                "footer": {
                    "text": "TickerTrace · A TraderMatrix product · tickertrace.pro",
                    "icon_url": "https://tickertrace.pro/brand/tm-mark.png",
                },
                "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
            }
        ],
    }


def post_to_discord(webhook_url: str, payload: dict) -> None:
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        webhook_url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        status = resp.status
    if status not in (200, 204):
        raise RuntimeError(f"Discord returned HTTP {status}")
    print(f"Posted to Discord (HTTP {status})")


def main() -> None:
    webhook_url = os.environ.get("DISCORD_WEBHOOK_URL") or (
        sys.argv[1] if len(sys.argv) > 1 else ""
    )
    if not webhook_url:
        sys.exit(
            "Error: supply a webhook URL as DISCORD_WEBHOOK_URL env var or first argument.\n"
            "Example: DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/... "
            "python3 scripts/discord_briefing.py"
        )

    print("Fetching briefing …")
    try:
        briefing_data = _get("/api/v1/briefing")
    except Exception as exc:
        sys.exit(f"Failed to fetch /api/v1/briefing: {exc}")

    print("Fetching sector flow …")
    try:
        sector_flow = _get("/api/v1/sectors")
    except Exception:
        sector_flow = {}

    # Attach asOfDate: /api/v1/stats has a small payload with it
    try:
        stats = _get("/api/v1/stats")
        briefing_data["asOfDate"] = stats.get("asOfDate", "")
    except Exception:
        briefing_data.setdefault("asOfDate", "")

    payload = _build_payload(briefing_data, sector_flow)
    print("Sending embed …")
    post_to_discord(webhook_url, payload)


if __name__ == "__main__":
    main()
