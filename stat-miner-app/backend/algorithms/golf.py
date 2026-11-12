from typing import Dict

from .base import ImpactScore, SportModule


MOCK_GOLF_STATS: Dict[str, Dict[str, float]] = {
    # strokes_gained_total, birdies, bogeys
    "Scottie Scheffler": {
        "strokes_gained_total": 3.5,
        "birdies": 5.0,
        "bogeys": 1.0,
    },
    "Rory McIlroy": {
        "strokes_gained_total": 2.8,
        "birdies": 4.0,
        "bogeys": 2.0,
    },
}


def _golf_impact(
    strokes_gained_total: float,
    birdies: float,
    bogeys: float,
) -> float:
    """
    Simple strokes-gained style impact metric for golf.
    """
    return strokes_gained_total * 5.0 + birdies * 1.0 - bogeys * 0.5


class GolfModule(SportModule):
    sport_name = "golf"

    def calculate_impact(self, player_name: str) -> ImpactScore:
        normalized_lookup = {name.lower(): name for name in MOCK_GOLF_STATS.keys()}
        key = normalized_lookup.get(player_name.lower())

        if key is None:
            raise ValueError("Player not found in golf mock data.")

        stats = MOCK_GOLF_STATS[key]
        score = _golf_impact(
            strokes_gained_total=stats["strokes_gained_total"],
            birdies=stats["birdies"],
            bogeys=stats["bogeys"],
        )

        return ImpactScore(
            sport=self.sport_name,
            player=key,
            impact_score=round(score, 3),
            details=stats,
        )

