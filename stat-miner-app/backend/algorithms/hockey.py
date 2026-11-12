from typing import Dict

from .base import ImpactScore, SportModule


MOCK_HOCKEY_STATS: Dict[str, Dict[str, float]] = {
    # goals, assists, shots_on_goal, time_on_ice_minutes
    "Connor McDavid": {
        "goals": 1.0,
        "assists": 2.0,
        "shots_on_goal": 6.0,
        "toi": 22.0,
    },
    "Nathan MacKinnon": {
        "goals": 1.0,
        "assists": 1.0,
        "shots_on_goal": 5.0,
        "toi": 21.0,
    },
}


def _hockey_impact(
    goals: float,
    assists: float,
    shots_on_goal: float,
    toi: float,
) -> float:
    """
    Simple skater impact metric for hockey.
    """
    return (goals * 4.0) + (assists * 3.0) + (shots_on_goal * 0.5) + (toi * 0.1)


class HockeyModule(SportModule):
    sport_name = "hockey"

    def calculate_impact(self, player_name: str) -> ImpactScore:
        normalized_lookup = {name.lower(): name for name in MOCK_HOCKEY_STATS.keys()}
        key = normalized_lookup.get(player_name.lower())

        if key is None:
            raise ValueError("Player not found in hockey mock data.")

        stats = MOCK_HOCKEY_STATS[key]
        score = _hockey_impact(
            goals=stats["goals"],
            assists=stats["assists"],
            shots_on_goal=stats["shots_on_goal"],
            toi=stats["toi"],
        )

        return ImpactScore(
            sport=self.sport_name,
            player=key,
            impact_score=round(score, 3),
            details=stats,
        )

