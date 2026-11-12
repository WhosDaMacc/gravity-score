"""
League-wide NBA Gravity rankings built on the cached league table.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from backend.algorithms.gravity import FORMULA, gravity_components, gravity_to_uvs
from backend.data_sources.nba_stats_provider import fetch_league_table, find_player, slugify

EDGE_THRESHOLD = 65.0


def _ranked_rows(players: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows = []
    for p in players:
        components = gravity_components(p["three_pa"], p["drives"], p["assists"], p["turnovers"])
        raw = sum(components.values())
        uvs = gravity_to_uvs(raw)
        rows.append({
            **p,
            "slug": slugify(p["player_name"]),
            "gravity": round(raw, 2),
            "uvs": round(uvs, 1),
            "edge_alert": uvs >= EDGE_THRESHOLD,
            "components": {k: round(v, 2) for k, v in components.items()},
        })

    rows.sort(key=lambda r: r["gravity"], reverse=True)
    total = len(rows)
    for i, row in enumerate(rows):
        prev = rows[i - 1] if i else None
        row["rank"] = prev["rank"] if prev and prev["gravity"] == row["gravity"] else i + 1
        below = sum(1 for r in rows if r["gravity"] < row["gravity"])
        row["percentile"] = round(100.0 * below / max(total - 1, 1), 1)
    return rows


def _meta(table: Dict[str, Any], count: int) -> Dict[str, Any]:
    return {
        "season": table["season"],
        "as_of": table["as_of"],
        "source": table["source"],
        "formula": FORMULA,
        "league_size": count,
    }


def leaderboard(season: Optional[str] = None) -> Dict[str, Any]:
    table = fetch_league_table(season)
    rows = _ranked_rows(table["players"])
    return {**_meta(table, len(rows)), "players": rows}


def player_profile(query: str, season: Optional[str] = None) -> Dict[str, Any]:
    table = fetch_league_table(season)
    rows = _ranked_rows(table["players"])
    match = find_player(rows, query)
    return {**_meta(table, len(rows)), "player": match}
