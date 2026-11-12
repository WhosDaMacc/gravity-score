"""
Daily props refresh: store any newly finished games' box scores, then fetch
today's sportsbook prop lines within PROPS_DAILY_CREDIT_BUDGET.

Run from stat-miner-app/ (each morning, before games):

    python scripts/refresh_props.py            # today; free if already fetched
    python scripts/refresh_props.py --force    # refetch today's lines (spends credits)
    python scripts/refresh_props.py --logs-only
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from backend.core import props  # noqa: E402
from backend.data_sources import espn_boxscores as espn  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="refetch lines even if today's are saved")
    parser.add_argument("--logs-only", action="store_true", help="only update game logs")
    args = parser.parse_args()

    today = espn.today_eastern()
    season = espn.season_for(today)
    for s in (espn.previous_season(season), season):
        store = espn.sync_season(s, force=True)
        print(f"Game logs {s}: {len(store['games'])} games, through {store['synced_through']}")

    if args.logs_only:
        return

    result = props.refresh_lines(today, force=args.force)
    markets = sorted({m for e in result["events"] for m in e["markets"]})
    print(
        f"Lines {result['date']}: {len(result['events'])} games, markets {markets or 'none'}, "
        f"spent {result['credits_spent']} credits, {result['credits_remaining']} remaining"
    )


if __name__ == "__main__":
    main()
