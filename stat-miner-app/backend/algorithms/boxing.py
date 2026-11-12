from typing import Dict

from .base import ImpactScore, SportModule


MOCK_BOXING_STATS: Dict[str, Dict[str, float]] = {
    # punches_landed, punches_thrown, knockdowns
    "Canelo Alvarez": {
        "punches_landed": 180.0,
        "punches_thrown": 450.0,
        "knockdowns": 1.0,
    },
    "Terence Crawford": {
        "punches_landed": 200.0,
        "punches_thrown": 420.0,
        "knockdowns": 2.0,
    },
}


def _boxing_impact(
    punches_landed: float,
    punches_thrown: float,
    knockdowns: float,
) -> float:
    """
    Simple impact metric for boxing.
    """
    accuracy = punches_landed / punches_thrown if punches_thrown else 0.0
    return punches_landed * 0.3 + accuracy * 10.0 + knockdowns * 6.0


class BoxingModule(SportModule):
    sport_name = "boxing"

    def calculate_impact(self, player_name: str) -> ImpactScore:
        normalized_lookup = {name.lower(): name for name in MOCK_BOXING_STATS.keys()}
        key = normalized_lookup.get(player_name.lower())

        if key is None:
            raise ValueError("Fighter not found in boxing mock data.")

        stats = MOCK_BOXING_STATS[key]
        score = _boxing_impact(
            punches_landed=stats["punches_landed"],
            punches_thrown=stats["punches_thrown"],
            knockdowns=stats["knockdowns"],
        )

        return ImpactScore(
            sport=self.sport_name,
            player=key,
            impact_score=round(score, 3),
            details=stats,
        )

