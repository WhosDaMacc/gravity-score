from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict

from pydantic import BaseModel, Field


class UnifiedValueScore(BaseModel):
    """
    Unified Value Score (UVS) output for any sport.

    - uvs:      0–100 score measuring betting value
    - edge_alert: True when UVS crosses an internal edge threshold
    """

    sport: str = Field(..., description="Sport identifier, e.g. 'racing', 'nba', 'ufc'.")
    category: str = Field(
        ..., description="High-level category, e.g. 'racing', 'combat', 'team'."
    )
    entity: str = Field(
        ..., description="The subject of the bet (horse, driver, team, fighter, etc.)."
    )
    market: str = Field(..., description="Market identifier, e.g. 'win', 'spread', 'outright'.")

    uvs: float = Field(
        ...,
        ge=0.0,
        le=100.0,
        description="Unified Value Score from 0–100.",
    )
    edge_alert: bool = Field(
        ...,
        description="True when the model flags a strong betting edge.",
    )

    components: Dict[str, float] = Field(
        default_factory=dict,
        description="Decomposed contributions (e.g. speed, track, odds_movement).",
    )
    raw: Dict[str, Any] = Field(
        default_factory=dict,
        description="Raw underlying stats used to compute UVS.",
    )


class BaseSport(ABC):
    """
    Base class for all sport adapters in the stat-mining engine.

    Subclasses are responsible for:
      - fetching sport-specific data for an event
      - turning that data into interpretable impact metrics
      - converting those metrics + odds into a UnifiedValueScore (UVS)
    """

    sport_key: str  # e.g. "racing", "basketball", "combat", "field"

    @abstractmethod
    def fetch_data(self, event_id: str) -> Dict[str, Any]:  # pragma: no cover - interface only
        """
        Fetch or assemble the latest stats for the given event.

        Implementations may hit external APIs, databases, or mock providers.
        """
        raise NotImplementedError

    @abstractmethod
    def calculate_impact(self, data: Dict[str, Any]) -> Dict[str, float]:  # pragma: no cover
        """
        Convert raw sport-specific data into normalized impact components.

        For example, Racing might return:
            {
                "speed_component": ...,
                "track_component": ...,
                "odds_movement_component": ...,
            }
        """
        raise NotImplementedError

    @abstractmethod
    def find_betting_edge(
        self,
        data: Dict[str, Any],
        odds: Dict[str, Any],
    ) -> UnifiedValueScore:  # pragma: no cover
        """
        Combine impact metrics with current sportsbook odds to derive a UVS and edge flag.
        """
        raise NotImplementedError

