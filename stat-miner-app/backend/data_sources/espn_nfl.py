"""
NFL player game logs built from ESPN's public box scores.

Mirrors backend/data_sources/espn_boxscores.py (NBA) exactly in shape:
finished games never change, so each box score is fetched once and stored
in backend/data/gamelogs/espn_nfl_<season>.json, and the store is only
extended with games not yet stored.

NFL seasons are a single year ("2026" runs Sep 2026 - Feb 2027).
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

BASE_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl"
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
STAT_FIELDS = [
    "pass_yds", "pass_tds", "pass_int",
    "rush_att", "rush_yds", "rush_tds",
    "rec", "rec_yds", "rec_tds", "targets",
    "fum_lost",
]

# ESPN boxscore statistic groups we parse, and which stored field each key
# maps to. Groups not listed here (defensive, kicking, punting, returns)
# are ignored: props only cover offensive skill stats.
_GROUP_FIELDS: Dict[str, Dict[str, str]] = {
    "passing": {
        "passingYards": "pass_yds",
        "passingTouchdowns": "pass_tds",
        "interceptions": "pass_int",
    },
    "rushing": {
        "rushingAttempts": "rush_att",
        "rushingYards": "rush_yds",
        "rushingTouchdowns": "rush_tds",
    },
    "receiving": {
        "receptions": "rec",
        "receivingYards": "rec_yds",
        "receivingTouchdowns": "rec_tds",
        "receivingTargets": "targets",
    },
    "fumbles": {
        "fumblesLost": "fum_lost",
    },
}

# A player counts as having played in a game when they appear in one of
# these groups (they only list participants). That keeps genuine 0-yard
# games (e.g. a back with 5 carries for 0 yards) in the logs instead of
# dropping them as all-zero lines.
_PLAYED_GROUPS = {"passing", "rushing", "receiving"}

_SYNC_INTERVAL_SECONDS = 30 * 60
_stores: Dict[str, Dict[str, Any]] = {}
_last_sync: Dict[str, float] = {}
_lock = threading.Lock()


class BoxScoreError(RuntimeError):
    """ESPN could not be reached or returned something unexpected."""


def today_eastern() -> date:
    return datetime.now(EASTERN).date()


def season_for(day: date) -> str:
    """NFL season year: a game in Sep 2026 - Feb 2027 is season "2026"."""
    start = day.year if day.month >= 9 else day.year - 1
    return str(start)


def previous_season(season: str) -> str:
    return str(int(season) - 1)


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


def fetch_boxscore(client: httpx.Client, game_id: str) -> List[Dict[str, Any]]:
    """
    Player lines for a finished game. One athlete appears in several groups
    (a QB passes and rushes), so rows are merged by athlete id. Players who
    didn't play are skipped; a line is kept when the player took part in a
    passing/rushing/receiving group or recorded any stored stat.
    """
    data = _get(client, "summary", {"event": game_id})
    merged: Dict[str, Dict[str, Any]] = {}
    for team_block in data.get("boxscore", {}).get("players", []):
        team = team_block["team"].get("abbreviation", "")
        for group in team_block.get("statistics", []):
            group_name = group.get("name", "")
            field_map = _GROUP_FIELDS.get(group_name)
            if not field_map:
                continue
            keys = group.get("keys", [])
            for athlete in group.get("athletes", []):
                raw = athlete.get("stats") or []
                if athlete.get("didNotPlay") or len(raw) != len(keys):
                    continue
                s = dict(zip(keys, raw))
                entry = merged.setdefault(athlete["athlete"]["id"], {
                    "id": athlete["athlete"]["id"],
                    "name": athlete["athlete"]["displayName"],
                    "team": team,
                    "stats": {f: 0.0 for f in STAT_FIELDS},
                    "played": False,
                })
                if group_name in _PLAYED_GROUPS:
                    entry["played"] = True
                for key, field in field_map.items():
                    entry["stats"][field] = _num(s.get(key))
    lines = []
    for entry in merged.values():
        if not entry["played"] and not any(v != 0 for v in entry["stats"].values()):
            continue
        lines.append({
            "id": entry["id"],
            "name": entry["name"],
            "team": entry["team"],
            "stats": [entry["stats"][f] for f in STAT_FIELDS],
        })
    return lines


def _store_path(season: str) -> Path:
    return STORE_DIR / f"espn_nfl_{season}.json"


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

        season_start = date(int(season), 9, 1)
        season_end = date(int(season) + 1, 2, 28)
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
