"""
Fetch the NBA league table live and save it as a snapshot the API can serve
when NBA.com blocks the production server.

Run from stat-miner-app/ on a machine that can reach NBA.com, then commit the file:

    python scripts/refresh_nba_snapshot.py            # current season
    python scripts/refresh_nba_snapshot.py 2025-26    # a specific season
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.data_sources.nba_stats_provider import (  # noqa: E402
    current_season,
    fetch_league_table,
    save_snapshot,
)


def main() -> None:
    seasons = sys.argv[1:] or [current_season()]
    for season in seasons:
        table = fetch_league_table(season, force_live=True)
        path = save_snapshot(table)
        estimated = sum(p["drives_estimated"] for p in table["players"])
        print(
            f"{season}: {len(table['players'])} players "
            f"({estimated} with estimated drives) -> {path}"
        )


if __name__ == "__main__":
    main()
