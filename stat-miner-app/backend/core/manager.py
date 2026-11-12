from typing import Dict

from backend.algorithms.base import ImpactScore, SportModule
from backend.algorithms.basketball import BasketballModule
from backend.algorithms.football import FootballModule
from backend.algorithms.hockey import HockeyModule
from backend.algorithms.soccer import SoccerModule
from backend.algorithms.golf import GolfModule
from backend.algorithms.ufc import UFCModule
from backend.algorithms.boxing import BoxingModule
from backend.services.supabase_service import get_supabase_service


class SportManager:
    """
    Orchestrates sport-specific modules behind a unified ImpactScore API.
    """

    def __init__(self, adapters: Dict[str, SportModule] | None = None) -> None:
        if adapters is None:
            adapters = {
                "basketball": BasketballModule(),
                "football": FootballModule(),  # NFL / NCAA both map here for now
                "hockey": HockeyModule(),
                "soccer": SoccerModule(),
                "golf": GolfModule(),
                "ufc": UFCModule(),
                "boxing": BoxingModule(),
            }
        # store keys normalized to lowercase
        self._adapters: Dict[str, SportModule] = {
            key.lower(): value for key, value in adapters.items()
        }
        self._supabase = get_supabase_service()

    @property
    def supported_sports(self) -> Dict[str, str]:
        """
        Returns mapping of sport key -> human-readable name.
        """
        return {
            key: adapter.sport_name for key, adapter in self._adapters.items()
        }

    def calculate_impact_score(
        self,
        sport: str,
        player_name: str,
        persist_ranking: bool = True,
        source: str = "api",
    ) -> ImpactScore:
        """
        Unified ImpactScore function for all sports.
        """
        sport_key = sport.lower()
        adapter = self._adapters.get(sport_key)
        if adapter is None:
            raise ValueError(f"Unsupported sport: {sport}")

        impact = adapter.calculate_impact(player_name)

        if persist_ranking and self._supabase.is_configured:
            # Fire-and-forget style; errors will bubble up if Supabase misconfigured.
            self._supabase.upsert_player_ranking_from_impact(impact, source=source)

        return impact

