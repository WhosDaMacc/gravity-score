from __future__ import annotations

from typing import Dict

from backend.algorithms.boxing import BoxingModule
from backend.algorithms.ufc import UFCModule
from backend.core.value_models import ValueScore


def _clip_0_100(x: float) -> float:
    return max(0.0, min(100.0, x))


class FightAdapter:
    """
    Adapter for fight sports: UFC and Boxing.

    It wraps the existing sport modules and rescales their ImpactScore into a
    0–100 ValueScore, plus a binary EdgeAlert.
    """

    EDGE_THRESHOLD = 70.0

    def __init__(self) -> None:
        self._ufc = UFCModule()
        self._boxing = BoxingModule()

        # Rough scaling calibration for impact -> 0–100.
        # These can be tuned from historical data later.
        self._ufc_min, self._ufc_max = 10.0, 80.0
        self._boxing_min, self._boxing_max = 20.0, 90.0

    def _scale(self, raw: float, lo: float, hi: float) -> float:
        if hi <= lo:
            return 50.0
        clipped = max(lo, min(hi, raw))
        return 100.0 * (clipped - lo) / (hi - lo)

    def _from_impact(
        self,
        sport: str,
        entity: str,
        raw_impact: float,
        details: Dict,
        lo: float,
        hi: float,
        market: str,
    ) -> ValueScore:
        value_score = _clip_0_100(self._scale(raw_impact, lo, hi))
        edge_alert = value_score >= self.EDGE_THRESHOLD

        return ValueScore(
            category="fight",
            sport=sport,
            entity=entity,
            market=market,
            value_score=round(value_score, 2),
            edge_alert=edge_alert,
            details={"impact_score": raw_impact, **details},
        )

    def evaluate(self, sport: str, fighter: str) -> ValueScore:
        """
        Unified entrypoint for fight value.

        sport:
          - "ufc"
          - "boxing"
        """
        sport_key = sport.lower()

        if sport_key == "ufc":
            impact = self._ufc.calculate_impact(fighter)
            return self._from_impact(
                sport="ufc",
                entity=impact.player,
                raw_impact=impact.impact_score,
                details=impact.details,
                lo=self._ufc_min,
                hi=self._ufc_max,
                market="moneyline",
            )

        if sport_key == "boxing":
            impact = self._boxing.calculate_impact(fighter)
            return self._from_impact(
                sport="boxing",
                entity=impact.player,
                raw_impact=impact.impact_score,
                details=impact.details,
                lo=self._boxing_min,
                hi=self._boxing_max,
                market="moneyline",
            )

        raise ValueError(f"Unsupported fight sport: {sport}")

