from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict

from pydantic import BaseModel


class ImpactScore(BaseModel):
    """
    Standard output format for all sports modules.
    """

    sport: str
    player: str
    impact_score: float
    details: Dict[str, Any]


class SportModule(ABC):
    """
    Base class for all sport modules.
    """

    sport_name: str

    @abstractmethod
    def calculate_impact(self, player_name: str) -> ImpactScore:  # pragma: no cover - interface only
        """
        Calculate an impact score for the given player and
        return it as an ImpactScore.
        """
        raise NotImplementedError

