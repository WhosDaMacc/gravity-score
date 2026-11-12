"""
Adapter for team sports (basketball, football, etc.) that use ImpactScore.
Converts ImpactScore to standardized ValueScore (0-100) for the dashboard.
"""

from __future__ import annotations

from typing import Any, Dict

from backend.algorithms.gravity import FORMULA as GRAVITY_FORMULA, gravity_to_uvs
from backend.core.manager import SportManager
from backend.core.value_models import ValueScore


def _clip_0_100(x: float) -> float:
    return max(0.0, min(100.0, x))


class TeamSportAdapter:
    """
    Adapter for team sports: Basketball, Football, Hockey, Soccer, etc.

    Wraps SportManager and rescales ImpactScore (raw Gravity Score, etc.)
    into a 0-100 ValueScore for consistency with fight/race adapters.
    """

    EDGE_THRESHOLD = 65.0

    def __init__(self) -> None:
        self._manager = SportManager()

    def evaluate_basketball(self, player_name: str) -> ValueScore:
        """Evaluate an NBA player and return ValueScore (0-100)."""
        impact = self._manager.calculate_impact_score(
            sport="basketball",
            player_name=player_name,
            persist_ranking=False,
        )
        uvs = _clip_0_100(gravity_to_uvs(impact.impact_score))
        edge_alert = uvs >= self.EDGE_THRESHOLD

        # Map raw stat keys to display-friendly names for the frontend
        stats: Dict[str, Any] = {}
        for k, v in impact.details.items():
            if k == "three_pa":
                stats["3PA"] = round(v, 1)
            elif k == "drives":
                stats["Drives"] = round(v, 1)
            elif k == "assists":
                stats["Ast"] = round(v, 1)
            elif k == "turnovers":
                stats["TOV"] = round(v, 1)
            else:
                stats[k] = v

        return ValueScore(
            category="team",
            sport="basketball",
            entity=impact.player,
            market="gravity",
            value_score=round(uvs, 2),
            edge_alert=edge_alert,
            details={"impact_score": impact.impact_score, "gravity_formula": GRAVITY_FORMULA, **stats},
        )
