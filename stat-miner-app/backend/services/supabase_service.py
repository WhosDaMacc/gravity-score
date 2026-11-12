import os
from typing import Any, Dict, Optional

try:
    from supabase import Client, create_client
    _SUPABASE_AVAILABLE = True
except ImportError:
    _SUPABASE_AVAILABLE = False
    Client = None  # type: ignore

from backend.algorithms.base import ImpactScore


class SupabaseService:
    """
    Thin wrapper around the Supabase client for odds/rankings storage.
    """

    def __init__(self) -> None:
        self._client: Optional[Any] = None
        if _SUPABASE_AVAILABLE:
            url = os.environ.get("SUPABASE_URL")
            key = os.environ.get("SUPABASE_KEY")
            if url and key:
                self._client = create_client(url, key)

    @property
    def is_configured(self) -> bool:
        return self._client is not None

    def upsert_betting_odds(self, payload: Dict[str, Any]) -> None:
        """
        Upsert a row into the `betting_odds` table.
        """
        if not self._client:
            return
        self._client.table("betting_odds").upsert(payload).execute()

    def upsert_player_ranking(self, payload: Dict[str, Any]) -> None:
        """
        Upsert a row into the `player_rankings` table.
        """
        if not self._client:
            return
        self._client.table("player_rankings").upsert(payload).execute()

    def get_past_bets(self) -> list:
        """
        Fetch past bets from `past_bets` table. Returns [] if not configured.
        """
        if not self._client:
            return []
        try:
            result = self._client.table("past_bets").select("*").order("date", desc=True).limit(100).execute()
            return list(result.data) if result.data else []
        except Exception:
            return []

    def add_past_bet(self, payload: Dict[str, Any]) -> None:
        """
        Insert a row into the `past_bets` table.
        Expects: sport, player, result (win|loss), uvs_at_bet, win_prob, date
        """
        if not self._client:
            return
        self._client.table("past_bets").insert(payload).execute()

    def upsert_player_ranking_from_impact(
        self,
        impact: ImpactScore,
        source: str = "impact_model",
    ) -> None:
        """
        Convenience helper to persist an ImpactScore into `player_rankings`.
        """
        row = {
            "sport": impact.sport,
            "player": impact.player,
            "impact_score": impact.impact_score,
            "details": impact.details,
            "source": source,
        }
        self.upsert_player_ranking(row)


_supabase_service = SupabaseService()


def get_supabase_service() -> SupabaseService:
    return _supabase_service

