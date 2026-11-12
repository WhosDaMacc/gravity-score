from __future__ import annotations

from typing import Any, Dict

from pydantic import BaseModel, Field


class ValueScore(BaseModel):
    """
    Standardized value signal for any sport/market.
    """

    category: str = Field(..., description="High-level category, e.g. 'race' or 'fight'.")
    sport: str = Field(..., description="Specific sport, e.g. 'horse_racing_uk', 'f1', 'ufc'.")
    entity: str = Field(..., description="The subject of the bet (horse, driver, fighter, etc.).")
    market: str | None = Field(
        default=None,
        description="Market or context label, e.g. 'outright', 'win', 'points'.",
    )

    value_score: float = Field(
        ...,
        ge=0.0,
        le=100.0,
        description="Modelled value from 0–100.",
    )
    edge_alert: bool = Field(
        ...,
        description="True when value_score exceeds internal edge threshold.",
    )

    details: Dict[str, Any] = Field(
        default_factory=dict,
        description="Raw metrics or debug info used to compute the value score.",
    )

