"""
Public track record for Gravity Score's own suggestions.

Each day, the picks the site publishes are snapshotted once (immutably) to
backend/data/picks/picks_<sport>_<YYYY-MM-DD>.json using the Python port of
the frontend picks engine (core/picks_engine.py) over that day's props
board. After the games finish, each pick is graded against the player's
actual game log for that date: hit / miss / push (exactly on the line) /
void (player has no log for a finished game — DNP). Parlays follow the
standard leg-removal rule: a missed leg loses the parlay, push/void legs
drop out, the parlay hits if every remaining leg hits, and it is void only
when every leg pushes or voids.

No backfill: the record starts the first day a snapshot is taken. Snapshots
are never regenerated or overwritten — grading only ADDS result fields.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.core import picks_engine, props

PICKS_DIR = Path(__file__).resolve().parent.parent / "data" / "picks"

RESULTS = ("hit", "miss", "push", "void")


# --------------------------------------------------------------------------
# Snapshot storage
# --------------------------------------------------------------------------

def _snapshot_path(sport: str, day: date, picks_dir: Optional[Path] = None) -> Path:
    return (picks_dir or PICKS_DIR) / f"picks_{sport}_{day.isoformat()}.json"


def load_snapshot(sport: str, day: date, picks_dir: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    path = _snapshot_path(sport, day, picks_dir)
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def _save_snapshot(snapshot: Dict[str, Any], picks_dir: Optional[Path] = None) -> None:
    path = _snapshot_path(snapshot["sport"], date.fromisoformat(snapshot["date"]), picks_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=1), encoding="utf-8")


def _serialize_pick(pick: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "player": pick["player_name"],
        "player_id": pick["player_id"],
        "team": pick["team"],
        "opp": pick["opp"],
        "game_id": pick["game_id"],
        "stat": pick["stat"],
        "line": pick["line"],
        "direction": pick["direction"],
        "estimate": pick["estimate"],
        "line_source": pick["line_source"],
    }


def _serialize_parlay(parlay: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": parlay["id"],
        "tier": parlay["tier"],
        "combined": parlay["combined"],
        "legs": [_serialize_pick(leg) for leg in parlay["legs"]],
    }


def snapshot_from_board(board: Dict[str, Any], sport: str) -> Dict[str, Any]:
    """Build (but do not save) a snapshot dict from a props board."""
    result = picks_engine.build_picks(board)
    return {
        "date": board["date"],
        "sport": sport,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "lines_mode": "book" if result["has_book_lines"] else "avg",
        "singles": [_serialize_pick(p) for p in result["singles"]],
        "parlays": {
            tier: [_serialize_parlay(p) for p in result["parlays"][tier]]
            for tier in picks_engine.TIER_ORDER
        },
        "final": False,
        "graded_at": None,
    }


def ensure_snapshot(
    sport: str,
    day: Optional[date] = None,
    board: Optional[Dict[str, Any]] = None,
    picks_dir: Optional[Path] = None,
) -> Optional[Dict[str, Any]]:
    """
    Return the day's snapshot, generating and saving it first if needed.
    Never overwrites an existing snapshot, and never snapshots a future day.
    Returns None when the board can't be built (e.g. data source down) and
    no snapshot exists yet.
    """
    sport = (sport or "nba").lower()
    espn = props.SPORTS[sport]["espn"]
    day = day or espn.today_eastern()
    if day > espn.today_eastern():
        return None
    existing = load_snapshot(sport, day, picks_dir)
    if existing is not None:
        return existing
    if board is None:
        try:
            board = props.build_board(day, sport)
        except Exception:
            return None  # serve what's stored; a later call retries
    if not board.get("games"):
        # No games that day: nothing was published, so nothing enters the
        # record. (Keeps a sport's "since" anchored to its first real slate
        # instead of an empty no-game day.)
        return None
    snapshot = snapshot_from_board(board, sport)
    _save_snapshot(snapshot, picks_dir)
    return snapshot


# --------------------------------------------------------------------------
# Grading
# --------------------------------------------------------------------------

def _actual_value(log_stats: List[float], stat_fields: List[str], stat: str) -> float:
    by_field = dict(zip(stat_fields, log_stats))
    return sum(by_field.get(part, 0) or 0 for part in picks_engine.STAT_PARTS[stat])


def _grade_one(
    pick: Dict[str, Any],
    day: date,
    players_by_id: Dict[str, Any],
    players_by_name: Dict[str, Any],
    finished_game_ids: set,
    today: date,
    stat_fields: List[str],
) -> None:
    """Set pick['actual'] and pick['result'] in place (result None = pending)."""
    entry = players_by_id.get(str(pick.get("player_id"))) or players_by_name.get(pick["player"])
    log = None
    if entry:
        log = next((l for l in entry["logs"] if l["date"] == day.isoformat()), None)
    if log is not None:
        actual = _actual_value(log["stats"], stat_fields, pick["stat"])
        pick["actual"] = actual
        if actual == pick["line"]:
            pick["result"] = "push"
        elif (actual > pick["line"]) == (pick["direction"] == "Over"):
            pick["result"] = "hit"
        else:
            pick["result"] = "miss"
        return
    pick["actual"] = None
    # No log for that date: the player didn't play (void) once the game is
    # known finished — the game is in the synced store, or the day is past.
    if pick.get("game_id") in finished_game_ids or day < today:
        pick["result"] = "void"
    else:
        pick["result"] = None


def _grade_parlay(parlay: Dict[str, Any]) -> None:
    results = [leg.get("result") for leg in parlay["legs"]]
    if any(r is None for r in results):
        parlay["result"] = None
    elif any(r == "miss" for r in results):
        parlay["result"] = "miss"
    elif any(r == "hit" for r in results):
        parlay["result"] = "hit"
    else:
        parlay["result"] = "void"


def grade_snapshot(
    sport: str,
    day: date,
    picks_dir: Optional[Path] = None,
) -> Optional[Dict[str, Any]]:
    """
    Grade a snapshot's picks against the actual game logs for that date.
    Idempotent: safe to re-run; a day is marked final once nothing is
    pending. Sync failures are tolerated (stored logs are used), following
    the same pattern as build_board.
    """
    sport = (sport or "nba").lower()
    snapshot = load_snapshot(sport, day, picks_dir)
    if snapshot is None or snapshot.get("final"):
        return snapshot

    espn = props.SPORTS[sport]["espn"]
    season = espn.season_for(day)
    prev = espn.previous_season(season)
    for s in (season, prev):
        try:
            espn.sync_season(s)
        except Exception:
            pass  # grade from what's already stored; the next call retries

    players = espn.player_logs([season, prev])
    players_by_name: Dict[str, Any] = {}
    for entry in players.values():
        players_by_name.setdefault(entry["name"], entry)

    finished_game_ids = set()
    for s in (season, prev):
        try:
            finished_game_ids |= set(espn._load_store(s).get("games", {}).keys())
        except Exception:
            pass

    today = espn.today_eastern()
    stat_fields = espn.STAT_FIELDS
    for pick in snapshot["singles"]:
        _grade_one(pick, day, players, players_by_name, finished_game_ids, today, stat_fields)
    for tier_parlays in snapshot["parlays"].values():
        for parlay in tier_parlays:
            for leg in parlay["legs"]:
                _grade_one(leg, day, players, players_by_name, finished_game_ids, today, stat_fields)
            _grade_parlay(parlay)

    pending = (
        any(p.get("result") is None for p in snapshot["singles"])
        or any(
            parlay.get("result") is None
            for tier_parlays in snapshot["parlays"].values()
            for parlay in tier_parlays
        )
    )
    snapshot["final"] = not pending
    snapshot["graded_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    _save_snapshot(snapshot, picks_dir)
    return snapshot


# --------------------------------------------------------------------------
# Aggregates + the history view
# --------------------------------------------------------------------------

def _aggregate(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    counts = {r: sum(1 for i in items if i.get("result") == r) for r in RESULTS}
    pending = sum(1 for i in items if i.get("result") is None)
    decided = counts["hit"] + counts["miss"]
    return {
        "n": counts["hit"] + counts["miss"] + counts["push"] + counts["void"],
        "hits": counts["hit"],
        "misses": counts["miss"],
        "pushes": counts["push"],
        "voids": counts["void"],
        "pending": pending,
        # Pushes and voids are not wins or losses; they leave the rate alone.
        "hit_rate": (counts["hit"] / decided) if decided else None,
    }


def _day_summary(snapshot: Dict[str, Any]) -> Dict[str, Any]:
    tier_parlays = snapshot["parlays"]
    all_parlays = [p for parlays in tier_parlays.values() for p in parlays]
    return {
        "date": snapshot["date"],
        "lines_mode": snapshot["lines_mode"],
        "final": bool(snapshot.get("final")),
        "generated_at": snapshot.get("generated_at"),
        "graded_at": snapshot.get("graded_at"),
        "singles": _aggregate(snapshot["singles"]),
        "parlays": {tier: _aggregate(tier_parlays[tier]) for tier in picks_engine.TIER_ORDER},
        "detail": {
            "singles": snapshot["singles"],
            "parlays": tier_parlays,
        },
    }


def _snapshot_days(sport: str, picks_dir: Optional[Path] = None) -> List[date]:
    days = []
    for path in sorted((picks_dir or PICKS_DIR).glob(f"picks_{sport}_*.json")):
        try:
            days.append(date.fromisoformat(path.stem.rsplit("_", 1)[1]))
        except ValueError:
            continue
    return days


def history(sport: str, picks_dir: Optional[Path] = None) -> Dict[str, Any]:
    """
    The public track record for one sport: today's snapshot is ensured (so
    the record starts accumulating even before a history page exists), every
    unfinal past day is graded, and per-day + total records are returned.
    """
    sport = (sport or "nba").lower()
    espn = props.SPORTS[sport]["espn"]
    today = espn.today_eastern()
    try:
        ensure_snapshot(sport, today, picks_dir=picks_dir)
    except Exception:
        pass

    days = []
    snapshots = []
    for day in _snapshot_days(sport, picks_dir):
        if day > today:
            continue
        snapshot = grade_snapshot(sport, day, picks_dir) or load_snapshot(sport, day, picks_dir)
        if snapshot is not None:
            snapshots.append(snapshot)
            days.append(_day_summary(snapshot))

    totals = {
        "singles": _aggregate([pick for snap in snapshots for pick in snap["singles"]]),
        "parlays": {
            tier: _aggregate([parlay for snap in snapshots for parlay in snap["parlays"][tier]])
            for tier in picks_engine.TIER_ORDER
        },
    }
    totals["parlays"]["all"] = _aggregate([
        parlay for snap in snapshots for parlays in snap["parlays"].values() for parlay in parlays
    ])

    return {
        "sport": sport,
        "days": days,
        "totals": totals,
        "since": days[0]["date"] if days else None,
    }
