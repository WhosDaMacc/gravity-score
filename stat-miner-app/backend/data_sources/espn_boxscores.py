"""
NBA player game logs built from ESPN's public box scores.

NBA.com's game-log endpoints and CDN refuse many IPs (including cloud hosts),
while ESPN's site API is open. Finished games never change, so each box score
is fetched once and stored in backend/data/gamelogs/espn_<season>.json.
"""

from __future__ import annotations

import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

import httpx

BASE_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
# ESPN rejects non-browser user agents.
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
    ),
}
STORE_DIR = Path(__file__).resolve().parent.parent / "data" / "gamelogs"
EASTERN = ZoneInfo("America/New_York")
REGULAR_SEASON = 2

# Order of per-game stat values stored for each player line.
STAT_FIELDS = ["min", "pts", "reb", "ast", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "stl", "blk", "tov"]

_SYNC_INTERVAL_SECONDS = 30 * 60
_stores: Dict[str, Dict[str, Any]] = {}
_last_sync: Dict[str, float] = {}
_lock = threading.Lock()


class BoxScoreError(RuntimeError):
    """ESPN could not be reached or returned something unexpected."""


def today_eastern() -> date:
    return datetime.now(EASTERN).date()


def season_for(day: date) -> str:
    start = day.year if day.month >= 9 else day.year - 1
    return f"{start}-{str(start + 1)[-2:]}"


def previous_season(season: str) -> str:
    start = int(season[:4]) - 1
    return f"{start}-{str(start + 1)[-2:]}"


def _get(client: httpx.Client, path: str, params: Dict[str, Any]) -> Dict[str, Any]:
    for attempt in range(3):
        try:
            response = client.get(f"{BASE_URL}/{path}", params=params)
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError) as exc:
            if attempt == 2:
                raise BoxScoreError(f"ESPN request failed ({path}): {exc}") from exc
            time.sleep(1.5 * (attempt + 1))
    raise BoxScoreError("unreachable")


def _team_info(competitor: Dict[str, Any]) -> Dict[str, str]:
    team = competitor["team"]
    return {
        "abbr": team.get("abbreviation", ""),
        "name": team.get("displayName", ""),
        "nickname": team.get("name") or team.get("shortDisplayName", ""),
    }


def fetch_scoreboard(client: httpx.Client, day: date) -> List[Dict[str, Any]]:
    """Games scheduled on one day (ESPN's API no longer accepts date ranges)."""
    data = _get(client, "scoreboard", {"dates": f"{day:%Y%m%d}"})
    games = []
    for event in data.get("events", []):
        comp = event["competitions"][0]
        home = next(c for c in comp["competitors"] if c["homeAway"] == "home")
        away = next(c for c in comp["competitors"] if c["homeAway"] == "away")
        games.append({
            "id": event["id"],
            "start": event["date"],
            "season_type": event.get("season", {}).get("type"),
            "completed": bool(event.get("status", {}).get("type", {}).get("completed")),
            "home": _team_info(home),
            "away": _team_info(away),
        })
    return games


def _num(value: str) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _split(value: str) -> tuple[float, float]:
    made, _, attempted = (value or "0-0").partition("-")
    return _num(made), _num(attempted)


def fetch_boxscore(client: httpx.Client, game_id: str) -> List[Dict[str, Any]]:
    """Player lines for a finished game; players who didn't play are skipped."""
    data = _get(client, "summary", {"event": game_id})
    lines = []
    for team_block in data.get("boxscore", {}).get("players", []):
        team = team_block["team"].get("abbreviation", "")
        for group in team_block.get("statistics", []):
            keys = group.get("keys", [])
            for athlete in group.get("athletes", []):
                raw = athlete.get("stats") or []
                if athlete.get("didNotPlay") or len(raw) != len(keys):
                    continue
                s = dict(zip(keys, raw))
                fgm, fga = _split(s.get("fieldGoalsMade-fieldGoalsAttempted"))
                fg3m, fg3a = _split(s.get("threePointFieldGoalsMade-threePointFieldGoalsAttempted"))
                ftm, fta = _split(s.get("freeThrowsMade-freeThrowsAttempted"))
                stats = {
                    "min": _num(s.get("minutes")), "pts": _num(s.get("points")),
                    "reb": _num(s.get("rebounds")), "ast": _num(s.get("assists")),
                    "fgm": fgm, "fga": fga, "fg3m": fg3m, "fg3a": fg3a, "ftm": ftm, "fta": fta,
                    "stl": _num(s.get("steals")), "blk": _num(s.get("blocks")),
                    "tov": _num(s.get("turnovers")),
                }
                if stats["min"] <= 0:
                    continue
                lines.append({
                    "id": athlete["athlete"]["id"],
                    "name": athlete["athlete"]["displayName"],
                    "team": team,
                    "stats": [stats[f] for f in STAT_FIELDS],
                })
    return lines


def _store_path(season: str) -> Path:
    return STORE_DIR / f"espn_{season}.json"


def _load_store(season: str) -> Dict[str, Any]:
    if season not in _stores:
        path = _store_path(season)
        if path.exists():
            _stores[season] = json.loads(path.read_text(encoding="utf-8"))
        else:
            _stores[season] = {"season": season, "fields": STAT_FIELDS, "synced_through": None, "games": {}}
    return _stores[season]


def _save_store(store: Dict[str, Any]) -> None:
    STORE_DIR.mkdir(parents=True, exist_ok=True)
    _store_path(store["season"]).write_text(json.dumps(store, separators=(",", ":")), encoding="utf-8")


def sync_season(season: str, force: bool = False) -> Dict[str, Any]:
    """
    Download box scores for every finished regular-season game not yet stored.
    Returns the store. Throttled to one attempt per 30 minutes unless forced.
    """
    with _lock:
        store = _load_store(season)
        if not force and time.time() - _last_sync.get(season, 0) < _SYNC_INTERVAL_SECONDS:
            return store
        _last_sync[season] = time.time()

        season_start = date(int(season[:4]), 10, 1)
        season_end = date(int(season[:4]) + 1, 4, 30)
        yesterday = today_eastern() - timedelta(days=1)
        end = min(season_end, today_eastern())
        synced = store.get("synced_through")
        if synced and date.fromisoformat(synced) >= season_end:
            return store
        start = max(season_start, date.fromisoformat(synced) - timedelta(days=1)) if synced else season_start
        if start > end:
            return store

        days = [start + timedelta(days=i) for i in range((end - start).days + 1)]
        with httpx.Client(timeout=20, headers=HEADERS) as client, ThreadPoolExecutor(max_workers=8) as pool:
            schedule = [g for games in pool.map(lambda d: fetch_scoreboard(client, d), days) for g in games]
            todo = [
                g for g in schedule
                if g["season_type"] == REGULAR_SEASON and g["completed"] and g["id"] not in store["games"]
            ]

            def load(game: Dict[str, Any]) -> tuple[Dict[str, Any], List[Dict[str, Any]]]:
                return game, fetch_boxscore(client, game["id"])

            for game, lines in pool.map(load, todo):
                game_day = datetime.fromisoformat(game["start"].replace("Z", "+00:00")).astimezone(EASTERN).date()
                store["games"][game["id"]] = {
                    "date": game_day.isoformat(),
                    "home": game["home"]["abbr"],
                    "away": game["away"]["abbr"],
                    "players": [[p["id"], p["name"], p["team"], *p["stats"]] for p in lines],
                }

        store["synced_through"] = min(yesterday, season_end).isoformat()
        _save_store(store)
        return store


def player_logs(seasons: List[str]) -> Dict[str, Dict[str, Any]]:
    """
    {athlete_id: {"name", "team" (latest), "logs": [{date, season, opp, home, stats}]}}
    with logs sorted newest first.
    """
    players: Dict[str, Dict[str, Any]] = {}
    for season in seasons:
        store = _load_store(season)
        for game in store["games"].values():
            for row in game["players"]:
                athlete_id, name, team, *stats = row
                is_home = team == game["home"]
                entry = players.setdefault(athlete_id, {"name": name, "team": team, "logs": [], "latest": ""})
                entry["logs"].append({
                    "date": game["date"],
                    "season": season,
                    "opp": game["away"] if is_home else game["home"],
                    "home": is_home,
                    "stats": stats,
                })
                if game["date"] > entry["latest"]:
                    entry.update(latest=game["date"], team=team, name=name)
    for entry in players.values():
        entry["logs"].sort(key=lambda log: log["date"], reverse=True)
    return players


def scoreboard_for(day: date) -> List[Dict[str, Any]]:
    with httpx.Client(timeout=20, headers=HEADERS) as client:
        return [g for g in fetch_scoreboard(client, day) if g["season_type"] == REGULAR_SEASON]


def store_status(season: str) -> Optional[str]:
    return _load_store(season).get("synced_through")
