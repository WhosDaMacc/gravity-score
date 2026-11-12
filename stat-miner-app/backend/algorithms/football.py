from typing import Dict

from .base import ImpactScore, SportModule


MOCK_FOOTBALL_STATS: Dict[str, Dict[str, float]] = {
    # Simple mock stats: passing_yards, rushing_yards, touchdowns, interceptions
    "Patrick Mahomes": {
        "passing_yards": 320.0,
        "rushing_yards": 25.0,
        "touchdowns": 3.0,
        "interceptions": 1.0,
    },
    "Josh Allen": {
        "passing_yards": 285.0,
        "rushing_yards": 45.0,
        "touchdowns": 3.0,
        "interceptions": 1.0,
    },
    "Lamar Jackson": {
        "passing_yards": 240.0,
        "rushing_yards": 80.0,
        "touchdowns": 2.0,
        "interceptions": 0.0,
    },
}


def _quarterback_impact(
    passing_yards: float,
    rushing_yards: float,
    touchdowns: float,
    interceptions: float,
) -> float:
    """
    Very simple football QB impact heuristic:

    impact = (passing_yards * 0.04) + (rushing_yards * 0.1) + (touchdowns * 6) - (interceptions * 2)
    """
    return (passing_yards * 0.04) + (rushing_yards * 0.1) + (touchdowns * 6.0) - (interceptions * 2.0)


class FootballModule(SportModule):
    sport_name = "football"

    def calculate_impact(self, player_name: str) -> ImpactScore:
        normalized_lookup = {name.lower(): name for name in MOCK_FOOTBALL_STATS.keys()}
        key = normalized_lookup.get(player_name.lower())

        if key is None:
            raise ValueError("Player not found in football mock data.")

        stats = MOCK_FOOTBALL_STATS[key]
        score = _quarterback_impact(
            passing_yards=stats["passing_yards"],
            rushing_yards=stats["rushing_yards"],
            touchdowns=stats["touchdowns"],
            interceptions=stats["interceptions"],
        )

        return ImpactScore(
            sport=self.sport_name,
            player=key,
            impact_score=round(score, 3),
            details=stats,
        )

