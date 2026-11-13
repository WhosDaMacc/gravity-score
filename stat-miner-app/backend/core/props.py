"""
NBA player props heat map: tonight's slate, sportsbook lines, and each player's
game logs so the frontend can compute how often they cleared a line.

Sportsbook lines cost Odds API credits (1 per market per game), so they are
only fetched by refresh_lines() — called from the admin endpoint or the
refresh script — and saved per day. Viewing the board never spends credits.
"""

from __future__ import annotations

import json
import os
import statistics
import threading
import time
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.data_sources import espn_boxscores as espn
from backend.data_sources import kalshi
from backend.data_sources.nba_stats_provider import slugify
from backend.data_sources.odds_provider import fetch_event_player_props, fetch_events

# Stat key -> The Odds API market. Stats without a market (3PA, FGA, ...) still
# get hit rates on the board, against a line the user sets.
MARKETS: Dict[str, str] = {
    "pts": "player_points",
    "reb": "player_rebounds",
    "ast": "player_assists",
    "fg3m": "player_threes",
    "pra": "player_points_rebounds_assists",
    "pr": "player_points_rebounds",
    "pa": "player_points_assists",
    "ra": "player_rebounds_assists",
    "stl": "player_steals",
    "blk": "player_blocks",
    "stocks": "player_blocks_steals",
    "tov": "player_turnovers",
}
STAT_BY_MARKET = {market: stat for stat, market in MARKETS.items()}

# Up to 10 bookmakers are billed as one region.
BOOKMAKERS = [
    "draftkings", "fanduel", "betmgm", "williamhill_us", "espnbet",
    "fanatics", "betrivers", "betonlineag", "prizepicks", "underdog",
]

DEFAULT_DAILY_CREDIT_BUDGET = 16  # ~500 free credits / 31 days
MIN_SEASON_MINUTES = 10.0
RECENT_LOGS = 20
BOARD_CACHE_SECONDS = 10 * 60
LINES_DIR = Path(__file__).resolve().parent.parent / "data" / "props"

KALSHI_CACHE_SECONDS = 3 * 60

_refresh_lock = threading.Lock()
_board_cache: Dict[str, Dict[str, Any]] = {}
_kalshi_cache: Dict[str, Dict[str, Any]] = {}


def _market_priority() -> List[str]:
    raw = os.getenv("PROPS_MARKETS", "")
    keys = [k.strip() for k in raw.split(",") if k.strip() in MARKETS] if raw else []
    return keys or list(MARKETS)


def _daily_budget() -> int:
    try:
        return max(0, int(os.getenv("PROPS_DAILY_CREDIT_BUDGET", DEFAULT_DAILY_CREDIT_BUDGET)))
    except ValueError:
        return DEFAULT_DAILY_CREDIT_BUDGET


def _lines_path(day: date) -> Path:
    return LINES_DIR / f"lines_{day.isoformat()}.json"


def load_lines(day: date) -> Optional[Dict[str, Any]]:
    path = _lines_path(day)
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def _consensus(points: List[float]) -> float:
    """Most common line across books; ties go to the one nearest the median."""
    counts = Counter(points)
    top = max(counts.values())
    tied = [p for p, c in counts.items() if c == top]
    median = statistics.median(points)
    return min(tied, key=lambda p: (abs(p - median), p))


def _parse_props(event_odds: Dict[str, Any]) -> Dict[str, Dict[str, Dict[str, Any]]]:
    by_stat: Dict[str, Dict[str, List[float]]] = {}
    offers: Dict[str, Dict[str, List[Dict[str, Any]]]] = {}
    for book in event_odds.get("bookmakers", []):
        for market in book.get("markets", []):
            stat = STAT_BY_MARKET.get(market.get("key", ""))
            if not stat:
                continue
            for outcome in market.get("outcomes", []):
                side, point, player = outcome.get("name"), outcome.get("point"), outcome.get("description")
                if side not in ("Over", "Under") or point is None or not player:
                    continue
                if side == "Over":
                    by_stat.setdefault(stat, {}).setdefault(player, []).append(float(point))
                link = outcome.get("link") or ""
                # Some books' links need the bettor's state filled in; skip those.
                if link and "{state}" not in link:
                    offers.setdefault(stat, {}).setdefault(player, []).append({
                        "book": book["key"], "side": side, "point": float(point),
                        "price": outcome.get("price"), "link": link,
                    })

    return {
        stat: {
            player: {
                "line": _consensus(points), "books": len(points), "low": min(points), "high": max(points),
                "offers": offers.get(stat, {}).get(player, []),
            }
            for player, points in players.items()
        }
        for stat, players in by_stat.items()
    }


def _slate_events(day: date) -> List[Dict[str, Any]]:
    events = []
    for event in fetch_events("nba"):
        start = datetime.fromisoformat(event["commence_time"].replace("Z", "+00:00"))
        if start.astimezone(espn.EASTERN).date() == day:
            events.append(event)
    return sorted(events, key=lambda e: e["commence_time"])


def refresh_lines(day: Optional[date] = None, force: bool = False) -> Dict[str, Any]:
    """
    Fetch tonight's prop lines within the daily credit budget and save them.
    Already-fetched days are returned as-is unless force=True.

    With G games and budget B, every game gets the top floor(B/G) markets so
    coverage is even; if B < G, the first B games get the top market.
    """
    day = day or espn.today_eastern()
    with _refresh_lock:
        existing = load_lines(day)
        if existing and not force:
            return existing

        events = _slate_events(day)
        budget = _daily_budget()
        priority = _market_priority()
        per_game = budget // len(events) if events else 0
        if events and per_game == 0:
            plan = [(event, priority[:1]) for event in events[:budget]]
        else:
            plan = [(event, priority[:per_game]) for event in events]

        saved_events = []
        remaining: Optional[int] = None
        spent = 0
        for event, stats in plan:
            entry = {
                "event_id": event["id"],
                "home_team": event["home_team"],
                "away_team": event["away_team"],
                "commence_time": event["commence_time"],
                "markets": stats,
                "props": {},
            }
            if stats:
                odds, remaining = fetch_event_player_props(
                    "nba", event["id"], [MARKETS[s] for s in stats], BOOKMAKERS,
                )
                spent += len(stats)
                entry["props"] = _parse_props(odds)
            saved_events.append(entry)

        result = {
            "date": day.isoformat(),
            "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "budget": budget,
            "credits_spent": spent,
            "credits_remaining": remaining,
            "events": saved_events,
        }
        LINES_DIR.mkdir(parents=True, exist_ok=True)
        _lines_path(day).write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
        _board_cache.pop(day.isoformat(), None)
        return result


_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}


def _name_key(name: str) -> str:
    return "-".join(t for t in slugify(name).split("-") if t not in _SUFFIXES)


def _team_matches(odds_team: str, espn_team: Dict[str, str]) -> bool:
    return bool(espn_team["nickname"]) and odds_team.lower().endswith(espn_team["nickname"].lower())


def _match_player(name: str, candidates: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    key = _name_key(name)
    exact = [p for p in candidates if p["key"] == key]
    if len(exact) == 1:
        return exact[0]
    last = key.split("-")[-1]
    first_initial = key[:1]
    loose = [p for p in candidates if p["key"].split("-")[-1] == last and p["key"][:1] == first_initial]
    return loose[0] if len(loose) == 1 else None


def kalshi_markets(day: Optional[date] = None) -> Dict[str, Any]:
    """
    Kalshi player prop markets for the day's board players:
    {"fetched_at", "players": {player_id: {stat: [market sorted by strike]}}}.
    Raises kalshi.KalshiError if Kalshi is unreachable.
    """
    day = day or espn.today_eastern()
    cached = _kalshi_cache.get(day.isoformat())
    if cached and time.time() - cached["built_at"] < KALSHI_CACHE_SECONDS:
        return cached["result"]

    board = build_board(day)
    by_key: Dict[str, List[str]] = {}
    for p in board["players"]:
        by_key.setdefault(_name_key(p["name"]), []).append(p["id"])

    players: Dict[str, Dict[str, List[Dict[str, Any]]]] = {}
    unmatched = set()
    for stat, markets in kalshi.player_prop_markets(day).items():
        for market in markets:
            ids = by_key.get(_name_key(market["name"]), [])
            if len(ids) != 1:
                unmatched.add(market["name"])
                continue
            players.setdefault(ids[0], {}).setdefault(stat, []).append(market)
    for stats in players.values():
        for markets in stats.values():
            markets.sort(key=lambda m: m["strike"])

    result = {
        "date": day.isoformat(),
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "players": players,
        "unmatched": sorted(unmatched),
    }
    _kalshi_cache[day.isoformat()] = {"result": result, "built_at": time.time()}
    return result


def game_results(requests: List[tuple[str, str]]) -> Dict[str, Optional[List[float]]]:
    """
    Stored box-score line for each (athlete id, YYYY-MM-DD), keyed "id:date",
    or None if that game isn't stored yet. Values follow espn.STAT_FIELDS.
    """
    seasons = sorted({espn.season_for(date.fromisoformat(d)) for _, d in requests})
    for s in seasons:
        try:
            espn.sync_season(s)
        except espn.BoxScoreError:
            pass
    players = espn.player_logs(seasons)
    out: Dict[str, Optional[List[float]]] = {}
    for athlete_id, day in requests:
        logs = players.get(athlete_id, {}).get("logs", [])
        out[f"{athlete_id}:{day}"] = next((log["stats"] for log in logs if log["date"] == day), None)
    return out


POSITION_GROUPS = ("G", "F", "C")


def defense_profile(season: str) -> Dict[str, Any]:
    """
    Per-game stats each team allows, overall ("ALL") and to guards, forwards and
    centers, plus the league averages to compare against.
    """
    games, positions = espn.season_games(season)
    width = len(espn.STAT_FIELDS)
    groups = ("ALL", *POSITION_GROUPS)
    sums: Dict[str, Dict[str, List[float]]] = {}
    counts: Counter = Counter()

    for game in games.values():
        home, away = game["home"], game["away"]
        allowed = {team: {g: [0.0] * width for g in groups} for team in (home, away)}
        for athlete_id, _name, team, *stats in game["players"]:
            defender = away if team == home else home
            pos = positions.get(athlete_id, "")
            for g in ("ALL", pos) if pos in POSITION_GROUPS else ("ALL",):
                acc = allowed[defender][g]
                for i, value in enumerate(stats):
                    acc[i] += value
        for team, by_group in allowed.items():
            counts[team] += 1
            team_sums = sums.setdefault(team, {g: [0.0] * width for g in groups})
            for g in groups:
                team_sums[g] = [a + b for a, b in zip(team_sums[g], by_group[g])]

    total_games = sum(counts.values())
    return {
        "season": season,
        "fields": espn.STAT_FIELDS,
        "games": dict(counts),
        "allowed": {
            team: {g: [round(v / counts[team], 2) for v in vals] for g, vals in by_group.items()}
            for team, by_group in sums.items()
        },
        "league": {
            g: [round(sum(sums[t][g][i] for t in sums) / total_games, 2) for i in range(width)]
            for g in groups
        } if total_games else {},
    }


def build_board(day: Optional[date] = None) -> Dict[str, Any]:
    day = day or espn.today_eastern()
    cached = _board_cache.get(day.isoformat())
    if cached and time.time() - cached["built_at"] < BOARD_CACHE_SECONDS:
        return cached["board"]

    season = espn.season_for(day)
    prev = espn.previous_season(season)
    for s in (season, prev):
        try:
            espn.sync_season(s)
        except espn.BoxScoreError:
            pass  # serve what's already stored; the next sync attempt retries
    players = espn.player_logs([season, prev])
    games = espn.scoreboard_for(day)
    lines = load_lines(day)

    board_games = []
    board_players: List[Dict[str, Any]] = []
    unmatched: List[str] = []

    for game in games:
        home, away = game["home"], game["away"]
        teams = {home["abbr"], away["abbr"]}
        odds_event = next(
            (e for e in (lines or {}).get("events", [])
             if _team_matches(e["home_team"], home) and _team_matches(e["away_team"], away)),
            None,
        )
        board_games.append({
            "id": game["id"],
            "start": game["start"],
            "home": home["abbr"],
            "away": away["abbr"],
            "home_name": home["name"],
            "away_name": away["name"],
            "markets": odds_event["markets"] if odds_event else [],
        })

        roster = []
        for athlete_id, p in players.items():
            if p["team"] not in teams:
                continue
            current = [log for log in p["logs"] if log["season"] == season]
            if not current:
                continue
            roster.append({
                "id": athlete_id,
                "key": _name_key(p["name"]),
                "player": p,
                "avg_min": sum(log["stats"][0] for log in current) / len(current),
                "lines": {},
            })

        for stat, props in (odds_event or {}).get("props", {}).items():
            for name, line in props.items():
                match = _match_player(name, roster)
                if match:
                    match["lines"][stat] = line
                else:
                    unmatched.append(name)

        for entry in roster:
            if entry["avg_min"] < MIN_SEASON_MINUTES and not entry["lines"]:
                continue
            p = entry["player"]
            opp = away["abbr"] if p["team"] == home["abbr"] else home["abbr"]
            current = [log for log in p["logs"] if log["season"] == season]
            older = [log for log in p["logs"] if log["season"] != season]
            keep_older = older[: max(0, RECENT_LOGS - len(current))] + [
                log for log in older[max(0, RECENT_LOGS - len(current)):] if log["opp"] == opp
            ]
            logs = current + keep_older
            board_players.append({
                "id": entry["id"],
                "name": p["name"],
                "pos": p["pos"],
                "team": p["team"],
                "opp": opp,
                "home": p["team"] == home["abbr"],
                "game_id": game["id"],
                "lines": entry["lines"],
                "logs": [
                    [log["date"], log["opp"], int(log["home"]), int(log["season"] != season), *log["stats"]]
                    for log in logs
                ],
            })

    board = {
        "date": day.isoformat(),
        "season": season,
        "log_fields": ["date", "opp", "home", "prev_season", *espn.STAT_FIELDS],
        "games": board_games,
        "players": board_players,
        "lines": {
            "fetched_at": lines["fetched_at"],
            "credits_remaining": lines.get("credits_remaining"),
            "markets": sorted({m for e in lines["events"] for m in e["markets"]}, key=list(MARKETS).index),
        } if lines else None,
        "defense": defense_profile(season),
        "unmatched_props": sorted(set(unmatched)),
        "logs_through": espn.store_status(season),
    }
    _board_cache[day.isoformat()] = {"board": board, "built_at": time.time()}
    return board
