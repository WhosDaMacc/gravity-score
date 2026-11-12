from typing import Dict

from .base import ImpactScore, SportModule


MOCK_UFC_STATS: Dict[str, Dict[str, float]] = {
    # sig_strikes_landed, takedowns, control_minutes, knockdowns
    "Islam Makhachev": {
        "sig_strikes_landed": 65.0,
        "takedowns": 3.0,
        "control_minutes": 6.5,
        "knockdowns": 1.0,
    },
    "Alexander Volkanovski": {
        "sig_strikes_landed": 110.0,
        "takedowns": 1.0,
        "control_minutes": 3.0,
        "knockdowns": 0.0,
    },
}


def _ufc_impact(
    sig_strikes_landed: float,
    takedowns: float,
    control_minutes: float,
    knockdowns: float,
) -> float:
    """
    Simple impact metric for UFC fighters.
    """
    return (
        sig_strikes_landed * 0.3
        + takedowns * 3.0
        + control_minutes * 0.8
        + knockdowns * 5.0
    )


class UFCModule(SportModule):
    sport_name = "ufc"

    def calculate_impact(self, player_name: str) -> ImpactScore:
        normalized_lookup = {name.lower(): name for name in MOCK_UFC_STATS.keys()}
        key = normalized_lookup.get(player_name.lower())

        if key is None:
            raise ValueError("Fighter not found in UFC mock data.")

        stats = MOCK_UFC_STATS[key]
        score = _ufc_impact(
            sig_strikes_landed=stats["sig_strikes_landed"],
            takedowns=stats["takedowns"],
            control_minutes=stats["control_minutes"],
            knockdowns=stats["knockdowns"],
        )

        return ImpactScore(
            sport=self.sport_name,
            player=key,
            impact_score=round(score, 3),
            details=stats,
        )

