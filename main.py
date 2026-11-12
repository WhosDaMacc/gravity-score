import sys
from pathlib import Path
from typing import Any, Dict

from fastapi import FastAPI, HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parent / "stat-miner-app"))

from backend.algorithms.basketball import MOCK_PLAYER_STATS  # noqa: E402
from backend.algorithms.gravity import FORMULA, gravity_score  # noqa: E402


app = FastAPI(title="Gravity Score Sports API")


@app.get("/gravity/{player_name}")
def get_gravity_score(player_name: str) -> Dict[str, Any]:
    """
    Return the Gravity Score for a given player using mock data.
    """
    # Normalize lookup to handle common capitalization differences.
    # We keep the original name in the response.
    normalized_lookup = {name.lower(): name for name in MOCK_PLAYER_STATS.keys()}
    key = normalized_lookup.get(player_name.strip().lower())

    if key is None:
        raise HTTPException(status_code=404, detail="Player not found in mock data.")

    stats = MOCK_PLAYER_STATS[key]
    score = gravity_score(
        three_point_attempts=stats["three_pa"],
        drives=stats["drives"],
        assists=stats["assists"],
        turnovers=stats["turnovers"],
    )

    return {
        "player": key,
        "gravity_score": round(score, 3),
        "formula": FORMULA,
        "data_source": "mock",
        "stats": stats,
    }


@app.get("/")
def root() -> Dict[str, str]:
    return {
        "message": "Gravity Score Sports API. Try /gravity/LeBron%20James or open /docs.",
    }
