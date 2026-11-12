from __future__ import annotations

from typing import Any, Dict

from backend.engine.base_sport import BaseSport, UnifiedValueScore


def _clip_0_100(x: float) -> float:
    return max(0.0, min(100.0, x))


class Racing(BaseSport):
    """
    Racing adapter implementing the Unified Value Score (UVS) for:
    - Horse/Greyhound racing
    - Motor racing (F1 / NASCAR) style markets

    UVS is driven by:
      - Speed Figures        (form, class, pace-adjusted ratings)
      - Track Conditions     (surface, going, lane bias)
      - Odds Movement        (price drift/steam vs model expectation)
    """

    sport_key = "racing"

    EDGE_THRESHOLD = 70.0  # default edge alert cutoff

    def fetch_data(self, event_id: str) -> Dict[str, Any]:
        """
        Placeholder implementation.

        In the full system, this will call into a data provider
        (e.g. mock_data_provider or a live API) to assemble fields like:

            {
                "runner_name": "Desert Crown",
                "speed_figure": 110.0,
                "track_condition_score": 0.85,
                "odds_movement": 0.15,  # positive = more generous price than model
            }
        """
        raise NotImplementedError(
            "Racing.fetch_data is not wired to a data provider yet. "
            "Pass pre-fetched data directly into calculate_impact/find_betting_edge for now."
        )

    def calculate_impact(self, data: Dict[str, Any]) -> Dict[str, float]:
        """
        Turn raw racing stats into normalized impact components.

        Expected keys in `data` (can be extended later):
          - speed_figure: numeric speed rating (e.g. 0–120)
          - track_condition_score: 0–1 measure of how well the runner fits the surface/going
          - odds_movement: -1..1, where positive means price has become more generous
        """
        speed_figure = float(data.get("speed_figure", 0.0))
        track_condition_score = float(data.get("track_condition_score", 0.5))
        odds_movement = float(data.get("odds_movement", 0.0))

        # Normalize speed into ~0–60 bucket (assuming 0–120 speed figs).
        speed_component = _clip_0_100(speed_figure / 120.0 * 60.0)

        # Track conditions contribute up to 25 points.
        track_component = _clip_0_100(track_condition_score * 25.0)

        # Odds movement: capture closing-line value (max +/- 15 points).
        # Positive movement (drift) can indicate value if fundamentals are strong.
        odds_movement_component = max(-15.0, min(15.0, odds_movement * 15.0))

        raw_uvs = speed_component + track_component + odds_movement_component

        return {
            "speed_component": speed_component,
            "track_component": track_component,
            "odds_movement_component": odds_movement_component,
            "uvs_raw": raw_uvs,
        }

    def find_betting_edge(
        self,
        data: Dict[str, Any],
        odds: Dict[str, Any],
    ) -> UnifiedValueScore:
        """
        Combine impact components with current odds into a UnifiedValueScore.

        `odds` is expected to contain at least:
          - market: e.g. "win", "place", "outright"
          - implied_prob: current implied win probability (0–1)

        We lightly adjust UVS based on how implied_prob lines up with the
        underlying impact metrics.
        """
        components = self.calculate_impact(data)
        uvs_raw = components["uvs_raw"]

        implied_prob = float(odds.get("implied_prob", 0.0))

        # If the runner looks strong (uvs_raw high) but implied_prob is modest,
        # we give a small bonus; if implied_prob is very high, we shave a bit off.
        value_bias = (0.3 - implied_prob) * 20.0  # center around ~30% fair win chance

        uvs = _clip_0_100(uvs_raw + value_bias)
        edge_alert = uvs >= self.EDGE_THRESHOLD

        return UnifiedValueScore(
            sport="racing",
            category="racing",
            entity=str(data.get("runner_name", "unknown_runner")),
            market=str(odds.get("market", "win")),
            uvs=round(uvs, 2),
            edge_alert=edge_alert,
            components=components,
            raw={"data": data, "odds": odds},
        )

