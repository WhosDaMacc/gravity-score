import os
from datetime import date
from typing import Any, Dict, List

from dotenv import load_dotenv

load_dotenv()

import secrets

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel, ConfigDict, Field

from backend.algorithms.base import ImpactScore
from backend.core.adapters.fight_adapter import FightAdapter
from backend.core.adapters.race_adapter import RaceAdapter
from backend.core.adapters.team_sport_adapter import TeamSportAdapter
from backend.core.manager import SportManager
from backend.core.value_models import ValueScore
from backend.core import nba_gravity, picks_history, props
from backend.data_sources.espn_boxscores import BoxScoreError
from backend.data_sources.nba_stats_provider import AmbiguousPlayerError, StatsUnavailableError
from backend.data_sources.odds_provider import (
    OddsProviderError,
    american_to_implied_prob,
    fetch_moneyline_odds_for_league,
)
from backend.services.supabase_service import get_supabase_service


app = FastAPI(title="Gravity Score API")

# CORS: allow frontend (any localhost port in dev)
_cors_origins = os.getenv("CORS_ORIGINS", "").strip()
if _cors_origins:
    _origins_list = [o.strip() for o in _cors_origins.split(",") if o.strip()]
else:
    _origins_list = [
        "http://localhost:5173", "http://localhost:5174", "http://localhost:5175",
        "http://127.0.0.1:5173", "http://127.0.0.1:5174", "http://127.0.0.1:5175",
    ]
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins_list,
    allow_origin_regex=os.getenv("CORS_ORIGIN_REGEX") or r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def require_admin(x_admin_token: str | None = Header(default=None)) -> None:
    """Write endpoints are disabled unless ADMIN_TOKEN is set and sent as X-Admin-Token."""
    expected = os.getenv("ADMIN_TOKEN", "")
    if not expected or not x_admin_token or not secrets.compare_digest(x_admin_token, expected):
        raise HTTPException(status_code=403, detail="Admin token required.")


sport_manager = SportManager()
supabase_service = get_supabase_service()
race_adapter = RaceAdapter()
fight_adapter = FightAdapter()
team_sport_adapter = TeamSportAdapter()


class BettingOddsIn(BaseModel):
    sport: str
    player: str
    market: str
    odds: float
    source: str
    line: float | None = None


class PlayerRankingIn(BaseModel):
    sport: str
    player: str
    ranking: float
    source: str
    extra: Dict[str, Any] | None = None


class EdgeDetailsOut(BaseModel):
    matchup: str
    stats: Dict[str, Any]


class EdgeTileOut(BaseModel):
    """
    Shape expected by the frontend dashboard for each edge tile.
    """

    model_config = ConfigDict(populate_by_name=True)

    id: int
    sport: str
    player: str
    uvs: float
    edge_alert: bool = Field(alias="edgeAlert")
    details: EdgeDetailsOut
    link: str | None = None


class BookQuoteOut(BaseModel):
    book: str
    price: float
    implied_prob: float


class BookEdgeOut(BaseModel):
    league: str
    market: str
    team_or_player: str
    matchup: str
    model_prob: float
    edge: float
    best_book: BookQuoteOut
    other_books: List[BookQuoteOut]


@app.get(
    "/impact/{sport}/{player_name}",
    response_model=ImpactScore,
)
def get_impact_score(sport: str, player_name: str) -> ImpactScore:
    """
    Unified endpoint: compute ImpactScore for any supported sport.
    """
    try:
        return sport_manager.calculate_impact_score(
            sport=sport,
            player_name=player_name,
            persist_ranking=True,
            source="impact_endpoint",
        )
    except StatsUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get(
    "/value/basketball/{player_name}",
    response_model=ValueScore,
)
def get_basketball_value(player_name: str) -> ValueScore:
    """
    Get standardized ValueScore (0-100) for an NBA player using Gravity Score.
    """
    try:
        return team_sport_adapter.evaluate_basketball(player_name)
    except StatsUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


SEASON_PATTERN = r"^\d{4}-\d{2}$"


def _parse_day(value: str | None) -> date | None:
    if value is None:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD") from exc


@app.get("/props/board")
def get_props_board(
    day: str | None = Query(default=None, alias="date"),
    sport: str = Query(default="nba"),
) -> Dict[str, Any]:
    """
    Tonight's slate with saved sportsbook prop lines and each player's game
    logs, for the props heat map. Never spends Odds API credits.
    sport: "nba" (default, keeps existing callers working) or "nfl".
    """
    if sport.lower() not in {"nba", "nfl"}:
        raise HTTPException(status_code=400, detail="sport must be one of: nba, nfl")
    try:
        return props.build_board(_parse_day(day), sport=sport.lower())
    except BoxScoreError as exc:
        raise HTTPException(status_code=503, detail="Game data is temporarily unavailable.") from exc


@app.get("/picks/history")
def get_picks_history(
    sport: str = Query(default="nba"),
) -> Dict[str, Any]:
    """
    Public track record of the site's own suggested bets: each day's picks
    are snapshotted once (never regenerated) and graded against the actual
    game logs — hit / miss / push / void — with per-day and overall hit
    rates (pushes and voids excluded). Ensures today's snapshot exists and
    grades any unfinal past days on the way. Never spends Odds API credits.
    sport: "nba" (default) or "nfl".
    """
    if sport.lower() not in {"nba", "nfl"}:
        raise HTTPException(status_code=400, detail="sport must be one of: nba, nfl")
    return picks_history.history(sport.lower())


@app.post("/props/refresh", dependencies=[Depends(require_admin)])
def refresh_props_lines(
    day: str | None = Query(default=None, alias="date"),
    force: bool = False,
    sport: str = Query(default="nba"),
) -> Dict[str, Any]:
    """
    Fetch the day's prop lines from The Odds API within the shared
    PROPS_DAILY_CREDIT_BUDGET (NBA + NFL draw from the same daily pool).
    Re-running the same day is free unless force=true.
    """
    if sport.lower() not in {"nba", "nfl"}:
        raise HTTPException(status_code=400, detail="sport must be one of: nba, nfl")
    try:
        result = props.refresh_lines(_parse_day(day), force=force, sport=sport.lower())
    except OddsProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {k: v for k, v in result.items() if k != "events"} | {
        "games": len(result["events"]),
        "markets": sorted({m for e in result["events"] for m in e["markets"]}),
    }


@app.get("/nba/leaderboard")
def get_nba_leaderboard(
    season: str | None = Query(default=None, pattern=SEASON_PATTERN),
) -> Dict[str, Any]:
    """
    Every qualifying NBA player ranked by Gravity Score, with the per-stat breakdown.
    """
    try:
        return nba_gravity.leaderboard(season)
    except StatsUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/nba/players/{query}")
def get_nba_player(
    query: str,
    season: str | None = Query(default=None, pattern=SEASON_PATTERN),
) -> Dict[str, Any]:
    """
    One player's Gravity profile. `query` is a URL slug (stephen-curry) or a name.
    """
    try:
        return nba_gravity.player_profile(query, season)
    except StatsUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except AmbiguousPlayerError as exc:
        raise HTTPException(
            status_code=409,
            detail={"message": str(exc), "candidates": exc.candidates[:10]},
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get(
    "/value/race/{market}/{runner}",
    response_model=ValueScore,
)
def get_race_value(market: str, runner: str) -> ValueScore:
    """
    Multi-sport ingestion: standardized ValueScore for racing markets.

    market:
      - horse_uk / horse_us
      - f1
    """
    try:
        return race_adapter.evaluate(market=market, runner=runner)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get(
    "/value/fight/{sport}/{fighter}",
    response_model=ValueScore,
)
def get_fight_value(sport: str, fighter: str) -> ValueScore:
    """
    Multi-sport ingestion: standardized ValueScore for UFC / Boxing.
    """
    try:
        return fight_adapter.evaluate(sport=sport, fighter=fighter)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get(
    "/dashboard/edges",
    response_model=List[EdgeTileOut],
)
def get_dashboard_edges() -> List[EdgeTileOut]:
    """
    Aggregate a small set of cross-sport edges for the frontend dashboard.

    In a real deployment this would pull from live feeds, odds APIs,
    and/or Supabase tables. For now we leverage the existing adapters
    and stat mining formulas.
    """
    edges: List[EdgeTileOut] = []
    next_id = 1

    # Basketball (real NBA data when nba_api installed)
    try:
        bball_edge = team_sport_adapter.evaluate_basketball("LeBron James")
        edges.append(
            EdgeTileOut(
                id=next_id,
                sport="NBA",
                player=bball_edge.entity,
                uvs=bball_edge.value_score,
                edge_alert=bball_edge.edge_alert,
                details=EdgeDetailsOut(
                    matchup="Season Gravity profile",
                    stats=bball_edge.details,
                ),
                link=None,
            )
        )
        next_id += 1
    except (ValueError, Exception):
        pass  # Skip if player not found or nba_api unavailable

    # UFC example
    try:
        ufc_edge = fight_adapter.evaluate("ufc", "Islam Makhachev")
        edges.append(
            EdgeTileOut(
                id=next_id,
                sport="UFC",
                player=ufc_edge.entity,
                uvs=ufc_edge.value_score,
                edge_alert=ufc_edge.edge_alert,
                details=EdgeDetailsOut(
                    matchup="Next opponent TBD",
                    stats=ufc_edge.details,
                ),
                link=None,
            )
        )
        next_id += 1
    except (ValueError, Exception):
        pass

    # Horse racing example (UK)
    horse_edge = race_adapter.evaluate("horse_uk", "Desert Crown")
    edges.append(
        EdgeTileOut(
            id=next_id,
            sport="Horse Racing",
            player=horse_edge.entity,
            uvs=horse_edge.value_score,
            edge_alert=horse_edge.edge_alert,
            details=EdgeDetailsOut(
                matchup="Royal Ascot – Feature Race",
                stats=horse_edge.details,
            ),
            link=None,
        )
    )
    next_id += 1

    # F1 example
    f1_edge = race_adapter.evaluate("f1", "Max Verstappen")
    edges.append(
        EdgeTileOut(
            id=next_id,
            sport="F1",
            player=f1_edge.entity,
            uvs=f1_edge.value_score,
            edge_alert=f1_edge.edge_alert,
            details=EdgeDetailsOut(
                matchup="Grand Prix Weekend",
                stats=f1_edge.details,
            ),
            link=None,
        )
    )
    next_id += 1

    # Boxing example
    boxing_edge = fight_adapter.evaluate("boxing", "Canelo Alvarez")
    edges.append(
        EdgeTileOut(
            id=next_id,
            sport="Boxing",
            player=boxing_edge.entity,
            uvs=boxing_edge.value_score,
            edge_alert=boxing_edge.edge_alert,
            details=EdgeDetailsOut(
                matchup="Next opponent TBD",
                stats=boxing_edge.details,
            ),
            link=None,
        )
    )

    return edges


@app.get(
    "/books/edges/{league}",
    response_model=List[BookEdgeOut],
)
def get_book_edges(league: str) -> List[BookEdgeOut]:
    """
    Skim best available moneyline bets across multiple books for a league.

    This endpoint uses an external odds provider (configured via ODDS_API_KEY)
    to fetch prices at several sportsbooks, then:

      - builds a consensus (average) implied probability for each team
      - finds the best available price (lowest implied probability) per team
      - reports the "edge" as (consensus_prob - best_book.implied_prob),
        so positive values mean the book is offering a better price than
        the market's implied probability suggests.
    """
    league_key = league.lower()
    if league_key not in {"nba", "nfl", "mlb"}:
        raise HTTPException(status_code=400, detail="league must be one of: nba, nfl, mlb")

    try:
        events = fetch_moneyline_odds_for_league(league_key)
    except OddsProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    edges: List[BookEdgeOut] = []

    for event in events:
        home = event.get("home_team", "")
        away = event.get("away_team", "")
        matchup = f"{away} @ {home}" if home and away else event.get("sport_title", "Unknown matchup")

        # Collect all prices per outcome name across bookmakers.
        outcome_prices: Dict[str, List[BookQuoteOut]] = {}

        for bookmaker in event.get("bookmakers", []):
            book_key = bookmaker.get("key", "")
            for market in bookmaker.get("markets", []):
                if market.get("key") != "h2h":
                    continue
                for outcome in market.get("outcomes", []):
                    name = outcome.get("name")
                    price = outcome.get("price")
                    if name is None or price is None:
                        continue
                    implied = american_to_implied_prob(float(price))
                    quote = BookQuoteOut(
                        book=book_key,
                        price=float(price),
                        implied_prob=implied,
                    )
                    outcome_prices.setdefault(name, []).append(quote)

        for name, quotes in outcome_prices.items():
            if not quotes:
                continue
            # Best book = lowest implied probability (best payout) for this side.
            best_book = min(quotes, key=lambda q: q.implied_prob)
            consensus_prob = sum(q.implied_prob for q in quotes) / len(quotes)
            edge = consensus_prob - best_book.implied_prob

            # Only keep meaningful edges (at least ~2 percentage points vs consensus).
            if edge < 0.02:
                continue

            edges.append(
                BookEdgeOut(
                    league=league_key.upper(),
                    market="moneyline",
                    team_or_player=name,
                    matchup=matchup,
                    model_prob=consensus_prob,
                    edge=edge,
                    best_book=best_book,
                    other_books=[q for q in quotes if q.book != best_book.book],
                )
            )

    # Sort by descending edge (strongest mispricings first) and limit to top 25.
    edges.sort(key=lambda e: e.edge, reverse=True)
    return edges[:25]


@app.post("/odds", dependencies=[Depends(require_admin)])
def upsert_betting_odds(payload: BettingOddsIn) -> Dict[str, Any]:
    """
    Store live betting odds in Supabase (`betting_odds` table).
    """
    if not supabase_service.is_configured:
        raise HTTPException(
            status_code=500,
            detail="Supabase is not configured (missing SUPABASE_URL / SUPABASE_KEY).",
        )

    supabase_service.upsert_betting_odds(payload.model_dump())
    return {"status": "ok"}


class PastBetIn(BaseModel):
    sport: str
    player: str
    result: str  # "win" | "loss"
    uvs_at_bet: float
    win_prob: float
    date: str


@app.get("/tracker/bets", response_model=List[Dict[str, Any]])
def get_past_bets() -> List[Dict[str, Any]]:
    """
    Fetch past bets from Supabase. Returns [] if Supabase not configured.
    """
    rows = supabase_service.get_past_bets()
    return [
        {
            "id": r.get("id", i),
            "sport": r.get("sport", ""),
            "player": r.get("player", ""),
            "result": r.get("result", "loss"),
            "uvsAtBet": float(r.get("uvs_at_bet", 0)),
            "winProb": float(r.get("win_prob", 0)),
            "date": r.get("date", ""),
        }
        for i, r in enumerate(rows, start=1)
    ]


@app.post("/tracker/bets", dependencies=[Depends(require_admin)])
def add_past_bet(payload: PastBetIn) -> Dict[str, Any]:
    """
    Add a past bet to Supabase. Requires SUPABASE_URL and SUPABASE_KEY.
    """
    if not supabase_service.is_configured:
        raise HTTPException(
            status_code=500,
            detail="Supabase is not configured. Set SUPABASE_URL and SUPABASE_KEY for bet tracking.",
        )
    supabase_service.add_past_bet(payload.model_dump())
    return {"status": "ok"}


@app.post("/rankings", dependencies=[Depends(require_admin)])
def upsert_player_ranking(payload: PlayerRankingIn) -> Dict[str, Any]:
    """
    Store player rankings in Supabase (`player_rankings` table).
    """
    if not supabase_service.is_configured:
        raise HTTPException(
            status_code=500,
            detail="Supabase is not configured (missing SUPABASE_URL / SUPABASE_KEY).",
        )

    row = {
        "sport": payload.sport,
        "player": payload.player,
        "impact_score": payload.ranking,
        "source": payload.source,
        "details": payload.extra or {},
    }
    supabase_service.upsert_player_ranking(row)
    return {"status": "ok"}


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/")
def root() -> Dict[str, str]:
    return {
        "message": (
            "Gravity Score API. Try /nba/leaderboard, /nba/players/stephen-curry, "
            "/impact/basketball/LeBron%20James, "
            "/value/race/horse_uk/Desert%20Crown, or /value/fight/ufc/Islam%20Makhachev"
        )
    }

