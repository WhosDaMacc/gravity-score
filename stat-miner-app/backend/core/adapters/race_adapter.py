from __future__ import annotations

from typing import Dict

from backend.core.value_models import ValueScore


def _clip_0_100(x: float) -> float:
    return max(0.0, min(100.0, x))


HORSE_RACING_UK: Dict[str, Dict[str, float]] = {
    # speed_rating (0–120), recent_form (0–1), track_suitability (0–1), implied_prob (0–1)
    "Desert Crown": {
        "speed_rating": 110.0,
        "recent_form": 0.9,
        "track_suitability": 0.85,
        "implied_prob": 0.35,
    },
    "Highfield Princess": {
        "speed_rating": 104.0,
        "recent_form": 0.8,
        "track_suitability": 0.75,
        "implied_prob": 0.28,
    },
}

HORSE_RACING_US: Dict[str, Dict[str, float]] = {
    "Flightline": {
        "speed_rating": 118.0,
        "recent_form": 1.0,
        "track_suitability": 0.9,
        "implied_prob": 0.6,
    },
    "Epicenter": {
        "speed_rating": 108.0,
        "recent_form": 0.85,
        "track_suitability": 0.8,
        "implied_prob": 0.32,
    },
}

F1_RACING: Dict[str, Dict[str, float]] = {
    # quali_pace_index (0–1.2), race_pace_index (0–1.2), reliability (0–1), implied_prob (0–1)
    "Max Verstappen": {
        "quali_pace_index": 1.15,
        "race_pace_index": 1.1,
        "reliability": 0.95,
        "implied_prob": 0.55,
    },
    "Lewis Hamilton": {
        "quali_pace_index": 1.05,
        "race_pace_index": 1.03,
        "reliability": 0.9,
        "implied_prob": 0.25,
    },
}


class RaceAdapter:
    """
    Adapter for racing markets: Horse Racing (UK/US) and F1.
    Returns a standardized ValueScore.
    """

    EDGE_THRESHOLD = 70.0

    def _horse_value(self, horse: str, region: str) -> ValueScore:
        region_key = region.lower()
        book = HORSE_RACING_UK if region_key == "uk" else HORSE_RACING_US

        normalized_lookup = {name.lower(): name for name in book.keys()}
        key = normalized_lookup.get(horse.lower())
        if key is None:
            raise ValueError(f"Horse not found in {region.upper()} mock data.")

        stats = book[key]
        # Simple heuristic: normalize speed_rating to ~0–100 and adjust by form/track/price.
        base = stats["speed_rating"] / 1.2  # 120 -> 100
        form_boost = stats["recent_form"] * 15.0
        track_boost = stats["track_suitability"] * 10.0
        price_penalty = stats["implied_prob"] * 10.0  # shorter price -> less value

        raw_value = base + form_boost + track_boost - price_penalty
        value_score = _clip_0_100(raw_value)
        edge_alert = value_score >= self.EDGE_THRESHOLD

        return ValueScore(
            category="race",
            sport=f"horse_racing_{region_key}",
            entity=key,
            market="win",
            value_score=round(value_score, 2),
            edge_alert=edge_alert,
            details=stats,
        )

    def _f1_value(self, driver: str) -> ValueScore:
        normalized_lookup = {name.lower(): name for name in F1_RACING.keys()}
        key = normalized_lookup.get(driver.lower())
        if key is None:
            raise ValueError("Driver not found in F1 mock data.")

        stats = F1_RACING[key]
        pace_score = (stats["quali_pace_index"] + stats["race_pace_index"]) / 2.0 * 80.0
        reliability_score = stats["reliability"] * 15.0
        price_penalty = stats["implied_prob"] * 10.0

        raw_value = pace_score + reliability_score - price_penalty
        value_score = _clip_0_100(raw_value)
        edge_alert = value_score >= self.EDGE_THRESHOLD

        return ValueScore(
            category="race",
            sport="f1",
            entity=key,
            market="race_win",
            value_score=round(value_score, 2),
            edge_alert=edge_alert,
            details=stats,
        )

    def evaluate(self, market: str, runner: str) -> ValueScore:
        """
        Unified entrypoint for racing value.

        market:
          - "horse_uk" / "horse_us"
          - "f1"
        """
        market_key = market.lower()
        if market_key == "horse_uk":
            return self._horse_value(runner, region="uk")
        if market_key == "horse_us":
            return self._horse_value(runner, region="us")
        if market_key == "f1":
            return self._f1_value(runner)

        raise ValueError(f"Unsupported race market: {market}")

