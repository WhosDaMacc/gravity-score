"""
NBA stats provider using nba_api (no API key required).
Fetches real player stats for Gravity Score: 3PA, drives, assists, turnovers.

The whole league table is fetched in one go and cached in memory. NBA.com
often blocks requests from cloud hosts, so when a live fetch fails we fall back
to the last cached copy, then to a JSON snapshot committed under
backend/data/snapshots (see scripts/refresh_nba_snapshot.py).
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

_HAS_PT_STATS = False
LeagueDashPtStats = None

try:
    from nba_api.stats.endpoints import LeagueLeaders
    try:
        from nba_api.stats.endpoints import LeagueDashPtStats
        _HAS_PT_STATS = True
    except ImportError:
        pass
    NBA_API_AVAILABLE = True
except ImportError:
    NBA_API_AVAILABLE = False

# Share of FGA used as a drives proxy when NBA.com tracking data is missing.
DRIVES_PER_FGA_ESTIMATE = 0.45

LEAGUE_CACHE_TTL_SECONDS = 60 * 60
SNAPSHOT_DIR = Path(__file__).resolve().parent.parent / "data" / "snapshots"

_cache: Dict[str, Dict[str, Any]] = {}
_cache_lock = threading.Lock()


class PlayerNotFoundError(ValueError):
    """No player in the season's stats matches the requested name."""


class AmbiguousPlayerError(ValueError):
    """The requested name matches more than one player."""

    def __init__(self, player_name: str, candidates: List[str]) -> None:
        self.candidates = candidates
        shown = ", ".join(candidates[:5])
        more = f" (+{len(candidates) - 5} more)" if len(candidates) > 5 else ""
        super().__init__(
            f"'{player_name}' matches multiple players: {shown}{more}. "
            "Use the full name."
        )


class StatsUnavailableError(RuntimeError):
    """NBA stats could not be fetched (nba_api missing or NBA.com unreachable)."""


def current_season() -> str:
    """Return current NBA season string, e.g. '2024-25'."""
    now = datetime.now()
    if now.month >= 10:  # Season starts Oct
        return f"{now.year}-{str(now.year + 1)[-2:]}"
    return f"{now.year - 1}-{str(now.year)[-2:]}"


def _normalize_name(name: str) -> str:
    """Lowercase and strip accents so 'Jokic' matches 'Jokić'."""
    decomposed = unicodedata.normalize("NFKD", name.strip().lower())
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def slugify(name: str) -> str:
    """URL slug for a player name, e.g. 'Nikola Jokić' -> 'nikola-jokic'."""
    return re.sub(r"[^a-z0-9]+", "-", _normalize_name(name)).strip("-")


def _snapshot_path(season: str) -> Path:
    return SNAPSHOT_DIR / f"nba_{season}.json"


def _fetch_live(season: str) -> Dict[str, Any]:
    if not NBA_API_AVAILABLE:
        raise StatsUnavailableError("nba_api is not installed. Run: pip install nba_api")

    request_kwargs: Dict[str, Any] = {"timeout": 30}
    proxy = os.getenv("NBA_API_PROXY", "").strip()
    if proxy:
        request_kwargs["proxy"] = proxy

    try:
        leaders = LeagueLeaders(
            per_mode48="PerGame",
            scope="S",
            season=season,
            season_type_all_star="Regular Season",
            stat_category_abbreviation="PTS",
            **request_kwargs,
        ).get_data_frames()[0]
    except Exception as exc:
        raise StatsUnavailableError(f"Could not fetch NBA stats for {season}: {exc}") from exc

    drives_by_id: Dict[Any, float] = {}
    if _HAS_PT_STATS and LeagueDashPtStats is not None:
        try:
            pt_df = LeagueDashPtStats(
                per_mode_simple="PerGame",
                player_or_team="Player",
                season=season,
                pt_measure_type="Drives",
                **request_kwargs,
            ).get_data_frames()[0]
            drives_by_id = {
                row["PLAYER_ID"]: float(row.get("DRIVES", 0) or 0)
                for _, row in pt_df.iterrows()
            }
        except Exception:
            drives_by_id = {}

    players = []
    for _, row in leaders.iterrows():
        player_id = row["PLAYER_ID"]
        drives = drives_by_id.get(player_id)
        fga = float(row.get("FGA", 0) or 0)
        players.append({
            "player_id": int(player_id),
            "player_name": str(row["PLAYER"]),
            "team": str(row.get("TEAM", "") or ""),
            "games": int(row.get("GP", 0) or 0),
            "minutes": float(row.get("MIN", 0) or 0),
            "three_pa": float(row.get("FG3A", 0) or 0),
            "drives": drives if drives is not None else round(fga * DRIVES_PER_FGA_ESTIMATE, 1),
            "drives_estimated": drives is None,
            "assists": float(row.get("AST", 0) or 0),
            "turnovers": float(row.get("TOV", 0) or 0),
        })

    if not players:
        raise StatsUnavailableError(f"NBA.com returned no players for {season}.")

    return {
        "season": season,
        "as_of": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "players": players,
    }


def _load_snapshot(season: str) -> Optional[Dict[str, Any]]:
    path = _snapshot_path(season)
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def save_snapshot(table: Dict[str, Any]) -> Path:
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    path = _snapshot_path(table["season"])
    data = {k: v for k, v in table.items() if k != "source"}
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    return path


def fetch_league_table(season: Optional[str] = None, force_live: bool = False) -> Dict[str, Any]:
    """
    Per-game stats for every qualifying player in a season.

    Returns {"season", "as_of", "source": "live" | "snapshot", "players": [...]}.
    Raises StatsUnavailableError if neither NBA.com nor a snapshot has data.
    """
    season = season or current_season()
    with _cache_lock:
        cached = _cache.get(season)
        if cached and not force_live and time.time() - cached["fetched_at"] < LEAGUE_CACHE_TTL_SECONDS:
            return cached["table"]

        try:
            table = {**_fetch_live(season), "source": "live"}
        except StatsUnavailableError:
            if force_live:
                raise
            if cached:
                return cached["table"]
            snapshot = _load_snapshot(season)
            if snapshot is None:
                raise
            table = {**snapshot, "source": "snapshot"}

        _cache[season] = {"table": table, "fetched_at": time.time()}
        return table


def find_player(players: List[Dict[str, Any]], query: str) -> Dict[str, Any]:
    """
    Resolve a name or URL slug to one player. Exact name/slug wins; otherwise a
    partial name match must be unique.
    """
    wanted = _normalize_name(query)
    wanted_slug = slugify(query)
    if not wanted_slug:
        raise PlayerNotFoundError("Player name is empty.")

    exact = [
        p for p in players
        if _normalize_name(p["player_name"]) == wanted or slugify(p["player_name"]) == wanted_slug
    ]
    if len(exact) == 1:
        return exact[0]

    partial = exact or [
        p for p in players
        if wanted in _normalize_name(p["player_name"]) or wanted_slug in slugify(p["player_name"])
    ]
    if not partial:
        raise PlayerNotFoundError(f"Player '{query}' not found in NBA stats.")
    if len(partial) > 1:
        raise AmbiguousPlayerError(query, [p["player_name"] for p in partial])
    return partial[0]


def fetch_player_stats(
    player_name: str, season: Optional[str] = None
) -> Dict[str, Any]:
    """
    Fetch real NBA stats for a player: three_pa, drives, assists, turnovers (per game).

    Returns dict with keys: three_pa, drives, assists, turnovers, drives_estimated,
    player_name (canonical).
    Raises PlayerNotFoundError / AmbiguousPlayerError for bad names and
    StatsUnavailableError when the data source can't be reached.
    """
    table = fetch_league_table(season)
    match = find_player(table["players"], player_name)
    return {
        "three_pa": match["three_pa"],
        "drives": match["drives"],
        "assists": match["assists"],
        "turnovers": match["turnovers"],
        "drives_estimated": match["drives_estimated"],
        "player_name": match["player_name"],
    }


def is_available() -> bool:
    """Return True if nba_api is installed and usable."""
    return NBA_API_AVAILABLE
