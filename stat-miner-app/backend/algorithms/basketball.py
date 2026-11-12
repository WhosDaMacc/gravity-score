import os
from typing import Any, Dict

from .base import ImpactScore, SportModule
from .gravity import gravity_score
from backend.data_sources.nba_stats_provider import (
    StatsUnavailableError,
    fetch_player_stats,
)


# Demo stats served only when GRAVITY_ALLOW_MOCK is enabled and NBA.com is unreachable.
MOCK_PLAYER_STATS: Dict[str, Dict[str, float]] = {
    "LeBron James": {"three_pa": 6.0, "drives": 12.0, "assists": 8.0, "turnovers": 3.0},
    "Stephen Curry": {"three_pa": 11.0, "drives": 7.0, "assists": 6.0, "turnovers": 2.0},
    "Giannis Antetokounmpo": {"three_pa": 3.0, "drives": 15.0, "assists": 5.0, "turnovers": 4.0},
}


def mock_allowed() -> bool:
    return os.getenv("GRAVITY_ALLOW_MOCK", "").strip().lower() in {"1", "true", "yes"}


class BasketballModule(SportModule):
    sport_name = "basketball"

    def calculate_impact(self, player_name: str) -> ImpactScore:
        details: Dict[str, Any]

        try:
            fetched = fetch_player_stats(player_name)
            display_name = fetched.pop("player_name")
            details = {**fetched, "data_source": "nba_api"}
        except StatsUnavailableError:
            if not mock_allowed():
                raise
            normalized_lookup = {name.lower(): name for name in MOCK_PLAYER_STATS}
            key = normalized_lookup.get(player_name.strip().lower())
            if key is None:
                raise
            display_name = key
            details = {**MOCK_PLAYER_STATS[key], "drives_estimated": False, "data_source": "mock"}

        score = gravity_score(
            three_point_attempts=details["three_pa"],
            drives=details["drives"],
            assists=details["assists"],
            turnovers=details["turnovers"],
        )

        return ImpactScore(
            sport=self.sport_name,
            player=display_name,
            impact_score=round(score, 3),
            details=details,
        )
