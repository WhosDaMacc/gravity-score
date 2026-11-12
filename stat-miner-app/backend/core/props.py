"""
Player props heat map: tonight's slate, sportsbook lines, and each player's
game logs so the frontend can compute how often they cleared a line.

Sportsbook lines cost Odds API credits (1 per market per game), so they are
only fetched by refresh_lines() — called from the admin endpoint or the
refresh script — and saved per day, per sport. Viewing the board never
spends credits.

Supported sports: NBA ("nba", the original) and NFL ("nfl"). Each sport has
its own ESPN game-log source and its own prop markets; the board shape and
the hit-rate math are shared.

Credit budget (shared across sports)
-------------------------------------
PROPS_DAILY_CREDIT_BUDGET (default 16/day, ~500 free credits / 31 days) is
one pool for every sport. A sport's refresh only spends what is left after
the other sports' already-saved lines for that day, so NBA + NFL can never
jointly exceed the daily budget. NFL starts at 1 market per game (passing
yards) and only on NFL game days; raise PROPS_MARKETS_NFL to add markets.
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

from backend.data_sources import espn_boxscores as espn_nba
from backend.data_sources import espn_nfl
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

# NFL point markets, verified offered for the Thu 2026-11-12 game
# (Washington @ NY Giants) via the per-event markets endpoint.
# player_anytime_td is also offered, but it is a Yes/No price market with no
# Over point, so the Over/point hit-rate math cannot use it yet — it is
# deliberately NOT in this map (see README: a scored-a-TD rate is the
# follow-up). player_rush_reception_yds is offered too and is the combo
# "rush_rec_yds" below.
NFL_MARKETS: Dict[str, str] = {
    "pass_yds": "player_pass_yds",
    "rush_yds": "player_rush_yds",
    "rec_yds": "player_reception_yds",
    "receptions": "player_receptions",
    "pass_tds": "player_pass_tds",
    "rush_rec_yds": "player_rush_reception_yds",
}

# Per-sport config. "espn" modules share one interface: today_eastern,
# season_for, previous_season, sync_season, player_logs, scoreboard_for,
# store_status, STAT_FIELDS, EASTERN.
SPORTS: Dict[str, Dict[str, Any]] = {
    "nba": {
        "espn": espn_nba,
        "markets": MARKETS,
        "odds_league": "nba",
        # NBA board keeps only players averaging 10+ minutes (or with a line).
        "min_season_minutes": 10.0,
    },
    "nfl": {
        "espn": espn_nfl,
        "markets": NFL_MARKETS,
        "odds_league": "nfl",
        "min_season_minutes": None,
        # NFL board keeps only players with a line or a meaningful
        # per-game average in a prop stat (regulars, not roster filler).
        "min_avg": {"pass_yds": 50.0, "rush_yds": 15.0, "rec_yds": 15.0, "receptions": 1.5},
        # NFL starts at 1 market per game (passing yards first), however
        # many games are on the slate — otherwise a 1-game Thursday would
        # spend the whole budget on that one game. Raise with an explicit
        # PROPS_MARKETS_NFL setting + a higher cap if the budget allows.
        "max_markets_per_game": 1,
    },
}

# Up to 10 bookmakers are billed as one region.
BOOKMAKERS = [
    "draftkings", "fanduel", "betmgm", "williamhill_us", "espnbet",
    "fanatics", "betrivers", "betonlineag", "prizepicks", "underdog",
]

DEFAULT_DAILY_CREDIT_BUDGET = 16  # ~500 free credits / 31 days
RECENT_LOGS = 20
BOARD_CACHE_SECONDS = 10 * 60
LINES_DIR = Path(__file__).resolve().parent.parent / "data" / "props"

_refresh_lock = threading.Lock()
_board_cache: Dict[str, Dict[str, Any]] = {}


def _sport_config(sport: str) -> Dict[str, Any]:
    cfg = SPORTS.get((sport or "nba").lower())
    if cfg is None:
        raise ValueError(f"Unsupported sport for props: {sport!r} (supported: {', '.join(SPORTS)})")
    return cfg


def _market_priority(sport: str) -> List[str]:
    cfg = _sport_config(sport)
    env_key = "PROPS_MARKETS" + ("_NFL" if sport == "nfl" else "")
    raw = os.getenv(env_key, "")
    markets = cfg["markets"]
    keys = [k.strip() for k in raw.split(",") if k.strip() in markets] if raw else []
    return keys or list(markets)


def _daily_budget() -> int:
    try:
        return max(0, int(os.getenv("PROPS_DAILY_CREDIT_BUDGET", DEFAULT_DAILY_CREDIT_BUDGET)))
    except ValueError:
        return DEFAULT_DAILY_CREDIT_BUDGET


def _lines_path(day: date, sport: str = "nba") -> Path:
    # NBA keeps the original filename so already-saved days keep working.
    if sport == "nba":
        return LINES_DIR / f"lines_{day.isoformat()}.json"
    return LINES_DIR / f"lines_{sport}_{day.isoformat()}.json"


def load_lines(day: date, sport: str = "nba") -> Optional[Dict[str, Any]]:
    path = _lines_path(day, sport)
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def _spent_today(day: date, exclude_sport: Optional[str] = None) -> int:
    """Credits already spent today across all sports (from saved lines files)."""
    spent = 0
    for sport in SPORTS:
        if sport == exclude_sport:
            continue
        saved = load_lines(day, sport)
        if saved:
            spent += int(saved.get("credits_spent") or 0)
    return spent


def _consensus(points: List[float]) -> float:
    """Most common line across books; ties go to the one nearest the median."""
    counts = Counter(points)
    top = max(counts.values())
    tied = [p for p, c in counts.items() if c == top]
    median = statistics.median(points)
    return min(tied, key=lambda p: (abs(p - median), p))


def _parse_props(event_odds: Dict[str, Any], sport: str = "nba") -> Dict[str, Dict[str, Dict[str, Any]]]:
    markets = _sport_config(sport)["markets"]
    stat_by_market = {market: stat for stat, market in markets.items()}
    by_stat: Dict[str, Dict[str, List[float]]] = {}
    for book in event_odds.get("bookmakers", []):
        for market in book.get("markets", []):
            stat = stat_by_market.get(market.get("key", ""))
            if not stat:
                continue
            for outcome in market.get("outcomes", []):
                if outcome.get("name") != "Over" or outcome.get("point") is None:
                    continue
                by_stat.setdefault(stat, {}).setdefault(outcome["description"], []).append(float(outcome["point"]))

    return {
        stat: {
            player: {"line": _consensus(points), "books": len(points), "low": min(points), "high": max(points)}
            for player, points in players.items()
        }
        for stat, players in by_stat.items()
    }


def _slate_events(day: date, sport: str = "nba") -> List[Dict[str, Any]]:
    cfg = _sport_config(sport)
    espn = cfg["espn"]
    events = []
    for event in fetch_events(cfg["odds_league"]):
        start = datetime.fromisoformat(event["commence_time"].replace("Z", "+00:00"))
        if start.astimezone(espn.EASTERN).date() == day:
            events.append(event)
    return sorted(events, key=lambda e: e["commence_time"])


def refresh_lines(day: Optional[date] = None, force: bool = False, sport: str = "nba") -> Dict[str, Any]:
    """
    Fetch a day's prop lines within the shared daily credit budget and save
    them. Already-fetched days are returned as-is unless force=True.

    The budget is shared across sports: this refresh may only spend
    PROPS_DAILY_CREDIT_BUDGET minus what other sports already spent today
    (read from their saved lines files). With G games and remaining budget
    B, every game gets the top floor(B/G) markets so coverage is even; if
    B < G, the first B games get the top market.
    """
    sport = (sport or "nba").lower()
    cfg = _sport_config(sport)
    espn = cfg["espn"]
    day = day or espn.today_eastern()
    with _refresh_lock:
        existing = load_lines(day, sport)
        if existing and not force:
            return existing

        events = _slate_events(day, sport)
        budget = max(0, _daily_budget() - _spent_today(day, exclude_sport=sport))
        priority = _market_priority(sport)
        per_game = budget // len(events) if events else 0
        # A per-sport cap (NFL: 1) so a short slate can't eat the budget.
        cap = cfg.get("max_markets_per_game")
        if cap is not None:
            env_cap = os.getenv("PROPS_MAX_MARKETS_NFL") if sport == "nfl" else None
            try:
                cap = int(env_cap) if env_cap is not None else int(cap)
            except ValueError:
                cap = int(cap)
            per_game = min(per_game, max(1, cap))
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
                    cfg["odds_league"], event["id"], [cfg["markets"][s] for s in stats], BOOKMAKERS,
                )
                spent += len(stats)
                entry["props"] = _parse_props(odds, sport)
            saved_events.append(entry)

        result = {
            "date": day.isoformat(),
            "sport": sport,
            "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "budget": budget,
            "credits_spent": spent,
            "credits_remaining": remaining,
            "events": saved_events,
        }
        LINES_DIR.mkdir(parents=True, exist_ok=True)
        _lines_path(day, sport).write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
        _board_cache.pop(f"{sport}:{day.isoformat()}", None)
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


def _stat_index(stat_fields: List[str], stat: str) -> int:
    """Index of a stat in a stored log row, or -1 for a combo stat."""
    return stat_fields.index(stat) if stat in stat_fields else -1


def _combo_parts(stat: str) -> List[str]:
    """Stats that are the sum of two stored fields (e.g. rush+rec yards)."""
    return {"rush_rec_yds": ["rush_yds", "rec_yds"]}.get(stat, [])


def _log_value(stats: List[float], stat_fields: List[str], stat: str) -> float:
    parts = _combo_parts(stat)
    if parts:
        return sum(stats[_stat_index(stat_fields, p)] for p in parts)
    idx = _stat_index(stat_fields, stat)
    return stats[idx] if idx >= 0 else 0.0


def _nfl_relevant(current_logs: List[Dict[str, Any]], stat_fields: List[str], min_avg: Dict[str, float]) -> bool:
    """Keep only NFL regulars: a meaningful per-game average in a prop stat."""
    if not current_logs:
        return False
    n = len(current_logs)
    for stat, threshold in min_avg.items():
        avg = sum(_log_value(log["stats"], stat_fields, stat) for log in current_logs) / n
        if avg >= threshold:
            return True
    return False


POSITION_GROUPS = ("G", "F", "C")


def defense_profile(season: str) -> Dict[str, Any]:
    """
    Per-game stats each NBA team allows, overall ("ALL") and to guards,
    forwards and centers, plus the league averages to compare against.
    NBA only: the frontend's matchup adjustment is built on these groups.
    """
    games, positions = espn_nba.season_games(season)
    width = len(espn_nba.STAT_FIELDS)
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
        "fields": espn_nba.STAT_FIELDS,
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


def build_board(day: Optional[date] = None, sport: str = "nba") -> Dict[str, Any]:
    sport = (sport or "nba").lower()
    cfg = _sport_config(sport)
    espn = cfg["espn"]
    markets = cfg["markets"]
    stat_fields = espn.STAT_FIELDS
    day = day or espn.today_eastern()
    cache_key = f"{sport}:{day.isoformat()}"
    cached = _board_cache.get(cache_key)
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
    lines = load_lines(day, sport)

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
            is_relevant = True
            if cfg.get("min_season_minutes") is not None:
                avg_min = sum(log["stats"][0] for log in current) / len(current)
                is_relevant = avg_min >= cfg["min_season_minutes"]
            elif cfg.get("min_avg") is not None:
                is_relevant = _nfl_relevant(current, stat_fields, cfg["min_avg"])
            roster.append({
                "id": athlete_id,
                "key": _name_key(p["name"]),
                "player": p,
                "relevant": is_relevant,
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
            if not entry["relevant"] and not entry["lines"]:
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
                "pos": p.get("pos", ""),
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
        "sport": sport,
        "season": season,
        "log_fields": ["date", "opp", "home", "prev_season", *stat_fields],
        "games": board_games,
        "players": board_players,
        "lines": {
            "fetched_at": lines["fetched_at"],
            "credits_remaining": lines.get("credits_remaining"),
            "markets": sorted({m for e in lines["events"] for m in e["markets"]}, key=list(markets).index),
        } if lines else None,
        "unmatched_props": sorted(set(unmatched)),
        "logs_through": espn.store_status(season),
        # Opponent-defense profile is an NBA concept (position groups G/F/C);
        # other sports get None and the frontend skips the matchup adjustment.
        "defense": defense_profile(season) if sport == "nba" else None,
    }
    _board_cache[cache_key] = {"board": board, "built_at": time.time()}
    return board
