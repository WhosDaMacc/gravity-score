"""
Kalshi NBA player prop markets (public API, no key or credits needed).

Kalshi lists props as ladders, e.g. "Tre Johnson: 20+ points" with
floor_strike 19.5, which is the same bet as Over 19.5. Buying Yes is the over,
buying No is the under. Prices are in dollars (0.54 = 54 cents = 54%).
"""

from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from typing import Any, Dict, List, Optional

import httpx

API = "https://api.elections.kalshi.com/trade-api/v2"

# Stat key (same as backend.core.props) -> Kalshi series tickers.
SERIES: Dict[str, List[str]] = {
    "pts": ["KXNBAPTS"],
    "reb": ["KXNBAREB"],
    "ast": ["KXNBAAST"],
    "fg3m": ["KXNBA3PT"],
    "pra": ["KXNBAPRA"],
    "pr": ["KXNBAPR"],
    "pa": ["KXNBAPA"],
    "ra": ["KXNBARA"],
    "stl": ["KXNBASTL"],
    "blk": ["KXNBABLK"],
    "stocks": ["KXNBASTOCK", "KXNBASTOCKS"],
}

_DATE_IN_TICKER = re.compile(r"-(\d{2})([A-Z]{3})(\d{2})")
_MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]


class KalshiError(RuntimeError):
    """Kalshi's API could not be reached."""


def _ticker_date(event_ticker: str) -> Optional[date]:
    match = _DATE_IN_TICKER.search(event_ticker)
    if not match or match.group(2) not in _MONTHS:
        return None
    yy, mon, dd = match.groups()
    return date(2000 + int(yy), _MONTHS.index(mon) + 1, int(dd))


def _price(value: Any) -> Optional[float]:
    try:
        price = float(value)
    except (TypeError, ValueError):
        return None
    return price if 0 < price < 1 else None


def _open_markets(client: httpx.Client, series: str) -> List[Dict[str, Any]]:
    markets: List[Dict[str, Any]] = []
    cursor = ""
    for _ in range(20):
        params = {"series_ticker": series, "status": "open", "limit": 1000}
        if cursor:
            params["cursor"] = cursor
        response = client.get(f"{API}/markets", params=params)
        response.raise_for_status()
        data = response.json()
        markets.extend(data.get("markets", []))
        cursor = data.get("cursor") or ""
        if not cursor:
            break
    return markets


def player_prop_markets(day: date) -> Dict[str, List[Dict[str, Any]]]:
    """{stat: [market, ...]} for games on `day`, with player name, strike and prices."""
    jobs = [(stat, series) for stat, tickers in SERIES.items() for series in tickers]
    try:
        with httpx.Client(timeout=20) as client, ThreadPoolExecutor(max_workers=6) as pool:
            fetched = list(pool.map(lambda job: (job[0], _open_markets(client, job[1])), jobs))
    except httpx.HTTPError as exc:
        raise KalshiError(f"Kalshi request failed: {exc}") from exc

    result: Dict[str, List[Dict[str, Any]]] = {}
    for stat, markets in fetched:
        for m in markets:
            title = m.get("title") or ""
            strike = m.get("floor_strike")
            if ":" not in title or strike is None or m.get("strike_type") != "greater":
                continue
            if _ticker_date(m.get("event_ticker", "")) != day:
                continue
            result.setdefault(stat, []).append({
                "name": title.split(":", 1)[0].strip(),
                "strike": float(strike),
                "yes_ask": _price(m.get("yes_ask_dollars")),
                "no_ask": _price(m.get("no_ask_dollars")),
                "last": _price(m.get("last_price_dollars")),
                "volume": float(m.get("volume_fp") or 0),
                "url": f"https://kalshi.com/events/{m['event_ticker'].lower()}",
            })
    return result
