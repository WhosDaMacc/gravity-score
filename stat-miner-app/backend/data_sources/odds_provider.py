from __future__ import annotations

import os
from typing import Any, Dict, List, Optional, Tuple

import httpx


class OddsProviderError(Exception):
    """Raised when the external odds provider cannot be reached or is misconfigured."""


# Map internal league keys to a generic odds API sport key.
# These values match The Odds API style keys, but you can
# adjust them to whichever provider you decide to use.
LEAGUE_TO_SPORT_KEY: Dict[str, str] = {
    "nba": "basketball_nba",
    "nfl": "americanfootball_nfl",
    "mlb": "baseball_mlb",
}


def _get_api_config() -> Dict[str, str]:
    api_key = os.environ.get("ODDS_API_KEY")
    if not api_key:
        raise OddsProviderError(
            "ODDS_API_KEY environment variable is not set. "
            "Sign up with an odds provider (e.g. The Odds API) and "
            "configure ODDS_API_KEY in your environment."
        )

    base_url = os.environ.get("ODDS_API_BASE_URL", "https://api.the-odds-api.com/v4")
    return {"api_key": api_key, "base_url": base_url}


def fetch_moneyline_odds_for_league(league: str) -> List[Dict[str, Any]]:
    """
    Fetch head-to-head (moneyline) odds for a given league (nba, nfl, mlb)
    from an external odds provider.

    The expected response shape is compatible with The Odds API:
    https://api.the-odds-api.com/

    This function is intentionally conservative and will raise
    OddsProviderError on configuration or HTTP errors so callers
    can handle fallbacks gracefully.
    """
    league_key = league.lower()
    if league_key not in LEAGUE_TO_SPORT_KEY:
        raise OddsProviderError(f"Unsupported league: {league}")

    cfg = _get_api_config()
    sport_key = LEAGUE_TO_SPORT_KEY[league_key]

    url = f"{cfg['base_url']}/sports/{sport_key}/odds"
    params = {
        "apiKey": cfg["api_key"],
        "regions": "us",  # focus on US books
        "markets": "h2h",  # head-to-head / moneyline only for now
        "oddsFormat": "american",
    }

    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.get(url, params=params)
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPError as exc:
        raise OddsProviderError(f"Failed to fetch odds: {exc}") from exc

    if not isinstance(data, list):
        raise OddsProviderError("Unexpected odds response format; expected a list of events.")

    return data


def fetch_events(league: str) -> List[Dict[str, Any]]:
    """Upcoming events for a league. Free: doesn't count against the credit quota."""
    cfg = _get_api_config()
    url = f"{cfg['base_url']}/sports/{LEAGUE_TO_SPORT_KEY[league]}/events"
    try:
        with httpx.Client(timeout=15.0) as client:
            response = client.get(url, params={"apiKey": cfg["api_key"]})
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as exc:
        raise OddsProviderError(f"Failed to fetch events: {exc}") from exc


def fetch_event_player_props(
    league: str,
    event_id: str,
    markets: List[str],
    bookmakers: List[str],
) -> Tuple[Dict[str, Any], Optional[int]]:
    """
    Player prop odds for one event, with bet-slip links where the book provides
    them. Costs one credit per market (up to 10 bookmakers count as a single
    region). Returns (event odds, credits remaining).
    """
    cfg = _get_api_config()
    url = f"{cfg['base_url']}/sports/{LEAGUE_TO_SPORT_KEY[league]}/events/{event_id}/odds"
    params = {
        "apiKey": cfg["api_key"],
        "markets": ",".join(markets),
        "bookmakers": ",".join(bookmakers[:10]),
        "oddsFormat": "american",
        "includeLinks": "true",
    }
    try:
        with httpx.Client(timeout=20.0) as client:
            response = client.get(url, params=params)
            response.raise_for_status()
            remaining = response.headers.get("x-requests-remaining")
            return response.json(), int(float(remaining)) if remaining else None
    except httpx.HTTPError as exc:
        raise OddsProviderError(f"Failed to fetch player props: {exc}") from exc


def american_to_implied_prob(price: float) -> float:
    """
    Convert American odds (e.g. -110, +150) to implied probability in [0, 1].
    """
    if price == 0:
        return 0.0
    if price > 0:
        return 100.0 / (price + 100.0)
    return -price / (-price + 100.0)

