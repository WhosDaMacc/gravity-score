from typing import Dict

from .base import ImpactScore, SportModule


MOCK_SOCCER_STATS: Dict[str, Dict[str, float]] = {
    # goals, assists, key_passes, xg (expected goals)
    "Lionel Messi": {
        "goals": 1.0,
        "assists": 1.0,
        "key_passes": 4.0,
        "xg": 0.8,
    },
    "Kylian Mbappe": {
        "goals": 2.0,
        "assists": 0.0,
        "key_passes": 2.0,
        "xg": 1.5,
    },
}


def _attacking_impact(
    goals: float,
    assists: float,
    key_passes: float,
    xg: float,
) -> float:
    """
    Simple attacking impact metric for soccer.

    impact = (goals * 4) + (assists * 3) + (key_passes * 0.5) + (xg * 1.5)
    """
    return (goals * 4.0) + (assists * 3.0) + (key_passes * 0.5) + (xg * 1.5)


class SoccerModule(SportModule):
    sport_name = "soccer"

    def calculate_impact(self, player_name: str) -> ImpactScore:
        normalized_lookup = {name.lower(): name for name in MOCK_SOCCER_STATS.keys()}
        key = normalized_lookup.get(player_name.lower())

        if key is None:
            raise ValueError("Player not found in soccer mock data.")

        stats = MOCK_SOCCER_STATS[key]
        score = _attacking_impact(
            goals=stats["goals"],
            assists=stats["assists"],
            key_passes=stats["key_passes"],
            xg=stats["xg"],
        )

        return ImpactScore(
            sport=self.sport_name,
            player=key,
            impact_score=round(score, 3),
            details=stats,
        )

