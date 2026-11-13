"""
Python port of the frontend picks engine (stat-miner-web/src/lib/picks.ts,
with analyze() from src/lib/props.ts), so the backend can snapshot the exact
suggestions the site publishes each day and grade them later
(see core/picks_history.py).

Faithfulness notes — what was ported and how:
- analyze()'s Clear % is ported exactly: per-window hit rates (pushes
  excluded), weights L5 .25 / L10 .30 / L20 .20 / SZN .15 / H2H .10 with the
  H2H weight scaled by min(n, 3) / 3, then shrunk toward 50% with
  SHRINK_GAMES = 3 over the L10 sample. The frontend's matchup adjustment is
  NOT part of Clear %: analyze() only feeds the matchup into the projection /
  probOver model, which the picks path never reads (buildCandidatePool uses
  a.clear, a.seasonGames and a.windows only). So this port needs no defense
  profile to reproduce the picks.
- Pool bars, tier specs, greedy parlay construction (including the Risky
  swing-leg variant and the drop-the-top-pick alternatives), the singles
  cutoff and per-player caps are copied rule-for-rule from picks.ts.
- One unavoidable approximation: the pool sort's final tie-break is
  playerName.localeCompare in JS (ICU collation). Python sorts by a
  diacritic-stripped, case-folded name key instead, which matches ICU
  primary ordering for the names involved but is not guaranteed identical
  for every possible name. Earlier keys (estimate, then L10 sample) are
  exact, and both sorts are stable over the same pool construction order.
"""

from __future__ import annotations

import math
import unicodedata
from functools import cmp_to_key
from typing import Any, Dict, List, Optional

# Stat iteration order matters (pool construction order feeds the stable
# sort), so these mirror STATS / NFL_STATS in props.ts exactly.
NBA_STATS: List[str] = [
    "pts", "reb", "ast", "fg3m", "pra", "pr", "pa", "ra",
    "fg3a", "fga", "fgm", "fta", "stl", "blk", "stocks", "tov",
]
NFL_STATS: List[str] = [
    "pass_yds", "rush_yds", "rec_yds", "receptions", "pass_tds", "rush_rec_yds",
]
SPORT_STATS: Dict[str, List[str]] = {"nba": NBA_STATS, "nfl": NFL_STATS}

# STAT_BY_KEY parts from props.ts (a stat's value is the sum of its parts).
# "receptions" is the frontend stat key; the stored NFL field is "rec".
STAT_PARTS: Dict[str, List[str]] = {
    "pts": ["pts"],
    "reb": ["reb"],
    "ast": ["ast"],
    "fg3m": ["fg3m"],
    "pra": ["pts", "reb", "ast"],
    "pr": ["pts", "reb"],
    "pa": ["pts", "ast"],
    "ra": ["reb", "ast"],
    "fg3a": ["fg3a"],
    "fga": ["fga"],
    "fgm": ["fgm"],
    "fta": ["fta"],
    "stl": ["stl"],
    "blk": ["blk"],
    "stocks": ["stl", "blk"],
    "tov": ["tov"],
    "pass_yds": ["pass_yds"],
    "rush_yds": ["rush_yds"],
    "rec_yds": ["rec_yds"],
    "receptions": ["rec"],
    "pass_tds": ["pass_tds"],
    "rush_rec_yds": ["rush_yds", "rec_yds"],
}

MIN_SEASON_GAMES = 5
MIN_L10_SAMPLE = 5
MIN_ACTIVE_GAMES = 3
POOL_MIN_ESTIMATE = 0.52
SINGLES_MIN_ESTIMATE = 0.58
MAX_SINGLES = 20
MAX_SINGLES_PER_PLAYER = 2
MAX_PARLAYS_PER_TIER = 3

SWING_STATS = {"pass_tds", "pra"}

TIER_SPECS: Dict[str, Dict[str, Any]] = {
    "safe": {"key": "safe", "leg_counts": [2], "min_estimate": 0.70, "max_per_game": 1},
    "moderate": {"key": "moderate", "leg_counts": [3], "min_estimate": 0.60, "max_per_game": 2},
    "risky": {"key": "risky", "leg_counts": [5, 4], "min_estimate": 0.52, "max_per_game": 2},
}
TIER_ORDER = ["safe", "moderate", "risky"]

WINDOWS = ["L5", "L10", "L20", "SZN", "H2H"]
WEIGHTS = {"L5": 0.25, "L10": 0.30, "L20": 0.20, "SZN": 0.15, "H2H": 0.10}
SHRINK_GAMES = 3


# --------------------------------------------------------------------------
# props.ts primitives (parseLogs / statValue / hitRate / defaultLine / analyze)
# --------------------------------------------------------------------------

def parse_logs(board: Dict[str, Any], player: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Board log rows -> {date, opp, home, prev_season, stats{field: value}}."""
    fields = board["log_fields"][4:]
    logs = []
    for row in player.get("logs", []):
        logs.append({
            "date": row[0],
            "opp": row[1],
            "home": row[2] == 1,
            "prev_season": row[3] == 1,
            "stats": {f: row[4 + i] for i, f in enumerate(fields)},
        })
    return logs


def stat_value(log: Dict[str, Any], stat: str) -> float:
    return sum(log["stats"].get(part, 0) or 0 for part in STAT_PARTS[stat])


def hit_rate(values: List[float], line: float) -> Dict[str, Any]:
    """A push (value exactly on the line) counts as neither a hit nor a miss."""
    hits = 0
    n = 0
    for v in values:
        if v == line:
            continue
        n += 1
        if v > line:
            hits += 1
    return {"hits": hits, "n": n, "rate": (hits / n) if n else None}


def default_line(logs: List[Dict[str, Any]], stat: str) -> float:
    season = [l for l in logs if not l["prev_season"]]
    pool = season if season else logs
    if not pool:
        return 0.5
    avg = sum(stat_value(l, stat) for l in pool) / len(pool)
    return math.floor(avg) + 0.5


def analyze_clear(logs: List[Dict[str, Any]], stat: str, line: float, opp: str) -> Dict[str, Any]:
    """
    The Clear % half of the frontend's analyze(): the blended hit rate, the
    five windows, and the season game count. (The projection / probOver half
    of analyze() is not used by the picks engine and is not ported.)
    """
    values = [stat_value(l, stat) for l in logs]
    season_values = [stat_value(l, stat) for l in logs if not l["prev_season"]]
    h2h_values = [stat_value(l, stat) for l in logs if l["opp"] == opp]
    windows = {
        "L5": hit_rate(values[:5], line),
        "L10": hit_rate(values[:10], line),
        "L20": hit_rate(values[:20], line),
        "SZN": hit_rate(season_values, line),
        "H2H": hit_rate(h2h_values, line),
    }

    weighted = 0.0
    total = 0.0
    for w in WINDOWS:
        rate, n = windows[w]["rate"], windows[w]["n"]
        if rate is None:
            continue
        weight = WEIGHTS["H2H"] * min(n, 3) / 3 if w == "H2H" else WEIGHTS[w]
        weighted += weight * rate
        total += weight
    sample = windows["L10"]["n"]
    clear = ((weighted / total) * sample + 0.5 * SHRINK_GAMES) / (sample + SHRINK_GAMES) if total else None
    return {"clear": clear, "windows": windows, "season_games": len(season_values)}


# --------------------------------------------------------------------------
# picks.ts engine
# --------------------------------------------------------------------------

def _name_sort_key(name: str) -> str:
    """Approximation of JS localeCompare: strip diacritics, fold case."""
    decomposed = unicodedata.normalize("NFKD", name)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).casefold()


def _by_estimate(a: Dict[str, Any], b: Dict[str, Any]) -> int:
    if a["estimate"] != b["estimate"]:
        return -1 if a["estimate"] > b["estimate"] else 1
    if a["windows"]["L10"]["n"] != b["windows"]["L10"]["n"]:
        return -1 if a["windows"]["L10"]["n"] > b["windows"]["L10"]["n"] else 1
    ka, kb = _name_sort_key(a["player_name"]), _name_sort_key(b["player_name"])
    if ka != kb:
        return -1 if ka < kb else 1
    return 0


def build_candidate_pool(board: Dict[str, Any]) -> List[Dict[str, Any]]:
    stats = SPORT_STATS.get(board.get("sport") or "nba", NBA_STATS)
    has_book_lines = any(len(p.get("lines") or {}) > 0 for p in board.get("players", []))
    pool: List[Dict[str, Any]] = []

    for player in board.get("players", []):
        logs = parse_logs(board, player)
        if not logs:
            continue
        for stat in stats:
            book = (player.get("lines") or {}).get(stat)
            # When books have posted lines for this slate, suggestions only
            # use real book lines; average-derived lines are the fallback
            # when no book lines exist at all.
            if has_book_lines and not book:
                continue
            line = book["line"] if book else default_line(logs, stat)
            active_games = sum(
                1 for l in logs if not l["prev_season"] and stat_value(l, stat) > 0
            )
            if active_games < MIN_ACTIVE_GAMES:
                continue
            a = analyze_clear(logs, stat, line, player["opp"])
            if a["clear"] is None:
                continue
            if a["season_games"] < MIN_SEASON_GAMES:
                continue
            if a["windows"]["L10"]["n"] < MIN_L10_SAMPLE:
                continue
            direction = "Over" if a["clear"] >= 0.5 else "Under"
            estimate = a["clear"] if direction == "Over" else 1 - a["clear"]
            if estimate < POOL_MIN_ESTIMATE:
                continue
            pool.append({
                "key": f"{player['id']}:{stat}",
                "player_id": player["id"],
                "player_name": player["name"],
                "team": player["team"],
                "opp": player["opp"],
                "home": player["home"],
                "game_id": player["game_id"],
                "stat": stat,
                "line": line,
                "direction": direction,
                "estimate": estimate,
                "clear": a["clear"],
                "windows": a["windows"],
                "season_games": a["season_games"],
                "line_source": "book" if book else "avg",
                "books": book.get("books") if book else None,
                "swing": stat in SWING_STATS,
            })

    pool.sort(key=cmp_to_key(_by_estimate))
    return pool


def _fits_tier(legs: List[Dict[str, Any]], candidate: Dict[str, Any], spec: Dict[str, Any]) -> bool:
    if any(l["player_id"] == candidate["player_id"] for l in legs):
        return False
    in_game = sum(1 for l in legs if l["game_id"] == candidate["game_id"])
    return in_game < spec["max_per_game"]


def _greedy_fill(
    eligible: List[Dict[str, Any]],
    leg_count: int,
    spec: Dict[str, Any],
    seed: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    legs = list(seed or [])
    for candidate in eligible:
        if len(legs) >= leg_count:
            break
        if any(l["key"] == candidate["key"] for l in legs):
            continue
        if _fits_tier(legs, candidate, spec):
            legs.append(candidate)
    return legs


def _combined(legs: List[Dict[str, Any]]) -> float:
    out = 1.0
    for leg in legs:
        out *= leg["estimate"]
    return out


def _build_tier_parlays(pool: List[Dict[str, Any]], spec: Dict[str, Any]) -> List[Dict[str, Any]]:
    eligible = [p for p in pool if p["estimate"] >= spec["min_estimate"]]
    parlays: List[Dict[str, Any]] = []
    seen = set()

    def add(legs: List[Dict[str, Any]]) -> None:
        if len(legs) not in spec["leg_counts"]:
            return
        signature = "|".join(sorted(l["key"] for l in legs))
        if signature in seen:
            return
        seen.add(signature)
        parlays.append({
            "id": f"{spec['key']}-{len(parlays) + 1}",
            "tier": spec["key"],
            "legs": legs,
            "combined": _combined(legs),
        })

    for leg_count in spec["leg_counts"]:
        if len(eligible) < leg_count:
            continue
        add(_greedy_fill(eligible, leg_count, spec))
        # Risky gets one variant built around the best available swing leg.
        if spec["key"] == "risky":
            swing = next((p for p in eligible if p["swing"]), None)
            if swing is not None:
                add(_greedy_fill(eligible, leg_count, spec, [swing]))
        # Alternatives: drop the top pick(s) and rebuild, for a different mix.
        drop = 1
        while drop < len(eligible) and len(parlays) < MAX_PARLAYS_PER_TIER:
            add(_greedy_fill(eligible[drop:], leg_count, spec))
            drop += 1
        if parlays:
            break  # longer leg count filled; don't also emit the shorter one

    parlays.sort(key=lambda p: -p["combined"])
    return parlays[:MAX_PARLAYS_PER_TIER]


def _shortfall_reason(pool: List[Dict[str, Any]], spec: Dict[str, Any], parlays: List[Dict[str, Any]]) -> Optional[str]:
    if parlays:
        return None
    leg_count = spec["leg_counts"][-1]
    eligible = [p for p in pool if p["estimate"] >= spec["min_estimate"]]
    if not pool:
        return (
            "No props passed the sample bar today (5+ season games and 5+ last-10 games), "
            "so there is nothing honest to build from."
        )
    if len(eligible) < leg_count:
        plural = "" if len(eligible) == 1 else "s"
        return (
            f"Only {len(eligible)} prop{plural} cleared the {round(spec['min_estimate'] * 100)}% bar "
            f"for this tier (needs {leg_count} legs). We won't pad a parlay with weaker legs."
        )
    return (
        f"Enough props cleared the bar, but they were too concentrated in the same games or "
        f"on the same players to build a {leg_count}-leg parlay under this tier's rules."
    )


def build_picks(board: Dict[str, Any]) -> Dict[str, Any]:
    """Mirror of buildPicks() in picks.ts, minus UI-only fields."""
    pool = build_candidate_pool(board)

    per_player: Dict[str, int] = {}
    singles: List[Dict[str, Any]] = []
    for pick in pool:
        if len(singles) >= MAX_SINGLES:
            break
        if pick["estimate"] < SINGLES_MIN_ESTIMATE:
            continue
        count = per_player.get(pick["player_id"], 0)
        if count >= MAX_SINGLES_PER_PLAYER:
            continue
        per_player[pick["player_id"]] = count + 1
        singles.append(pick)

    parlays: Dict[str, List[Dict[str, Any]]] = {}
    shortfalls: Dict[str, Optional[str]] = {}
    for key in TIER_ORDER:
        parlays[key] = _build_tier_parlays(pool, TIER_SPECS[key])
        shortfalls[key] = _shortfall_reason(pool, TIER_SPECS[key], parlays[key])

    return {
        "sport": board.get("sport") or "nba",
        "date": board["date"],
        "has_book_lines": any(len(p.get("lines") or {}) > 0 for p in board.get("players", [])),
        "singles": singles,
        "parlays": parlays,
        "shortfalls": shortfalls,
        "pool_size": len(pool),
    }
