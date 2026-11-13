# Gravity Score

Gravity Score ranks every NBA player by how much they bend the defense: spacing, rim pressure and playmaking, using NBA.com stats. It's two parts:

- `stat-miner-web/`: the website (React + Vite + Tailwind). Pages: `/` home, `/leaderboard`, `/players/:slug` (e.g. `/players/stephen-curry`), `/how-it-works`, and `/dashboard` (multi-sport preview; non-NBA sports are demo data).
- `stat-miner-app/`: the FastAPI backend. Main endpoints: `GET /nba/leaderboard`, `GET /nba/players/{slug}`, `GET /health`.

The Gravity Score is calculated as:

\[
\text{Gravity Score} = (3PA \times 1.5) + (Drives \times 1.2) + \frac{Assists \times 2.0}{Turnovers + 1}
\]

The weights and the 0–100 UVS scaling live in one place: `stat-miner-app/backend/algorithms/gravity.py`. Both the root app and the Stat Miner API import from it.

Responses include `data_source` (`nba_api` or `mock`) and `drives_estimated` (true when NBA.com drive tracking was unavailable and drives were estimated from field-goal attempts).

## Setup

1. Create and activate a virtual environment (optional but recommended).
2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. **Real data (optional):** Copy `.env.example` to `.env` and add your API keys:

```bash
cp .env.example .env
```

- **NBA stats:** No API key needed. Uses `nba_api` (included in requirements) to pull real stats from NBA.com. If NBA.com is unreachable the API returns 503; set `GRAVITY_ALLOW_MOCK=1` in development to fall back to demo stats instead (never in production).
- **Odds (NBA/NFL/MLB):** Get a free key at [the-odds-api.com](https://the-odds-api.com/) and set `ODDS_API_KEY`.
- **Supabase:** For storing odds, rankings, and bet tracking, set `SUPABASE_URL` and `SUPABASE_KEY`.

  If using bet tracking, create a `past_bets` table in Supabase:

  ```sql
  CREATE TABLE past_bets (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    sport TEXT NOT NULL,
    player TEXT NOT NULL,
    result TEXT NOT NULL CHECK (result IN ('win', 'loss')),
    uvs_at_bet FLOAT NOT NULL,
    win_prob FLOAT NOT NULL,
    date TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  );
  ```

4. Run the Stat Miner API:

```bash
cd stat-miner-app
uvicorn backend.api.main:app --reload
```

Or the simple Gravity Score app from the project root:

```bash
uvicorn main:app --reload
```

5. Run the web frontend (optional):

```bash
cd stat-miner-web
npm install
npm run dev
```

Then open http://localhost:5173. Create `stat-miner-web/.env.local` with `VITE_API_URL=http://localhost:8000` if your backend runs elsewhere.

6. Test the API endpoints:

- `GET http://127.0.0.1:8000/nba/leaderboard` (add `?season=2025-26` for a past season)
- `GET http://127.0.0.1:8000/nba/players/stephen-curry`
- `GET http://127.0.0.1:8000/impact/basketball/LeBron%20James` (real NBA data when nba_api installed)
- `GET http://127.0.0.1:8000/value/basketball/LeBron%20James` (UVS 0–100)
- `GET http://127.0.0.1:8000/books/edges/nba` (requires ODDS_API_KEY)
- `http://127.0.0.1:8000/docs` — interactive API docs

## NBA data and snapshots

The API fetches the full league table from NBA.com and caches it for an hour. NBA.com frequently blocks requests from cloud servers (Render, AWS, etc.), so when a live fetch fails the API serves the newest snapshot in `stat-miner-app/backend/data/snapshots/` and the site labels it "snapshot from <date>".

Refresh snapshots from a machine that can reach NBA.com (e.g. your laptop), then commit and push:

```bash
cd stat-miner-app
python scripts/refresh_nba_snapshot.py            # current season
python scripts/refresh_nba_snapshot.py 2025-26    # a specific season
```

To get live data in production instead, set `NBA_API_PROXY` to a residential/HTTP proxy.

## Props heat map (`/props`)

For tonight's NBA slate, the props page shows how often each player cleared a line (last 5/10/20 games, this season, and head-to-head vs tonight's opponent), the opponent's defense for that stat, and a matchup-adjusted probability of going over.

- **Game logs** come from ESPN's public box scores (NBA.com blocks many IPs) and are stored in `stat-miner-app/backend/data/gamelogs/`. Finished games never change, so each is downloaded once; the API adds new games automatically.
- **Sportsbook lines** come from The Odds API (`ODDS_API_KEY`). They cost credits (1 per stat type per game), so they are only fetched by the daily refresh, never by page views:

  ```bash
  cd stat-miner-app
  python scripts/refresh_props.py          # run each morning; free if today's lines are already saved
  python scripts/refresh_props.py --force  # refetch today's lines (spends credits)
  ```

  In production, call `POST /props/refresh` with the `X-Admin-Token` header instead (e.g. from a free daily cron at cron-job.org). Lines are saved in `backend/data/props/`; on Render's free plan that disk resets on restart, so the cron should run after the service wakes.
- `PROPS_DAILY_CREDIT_BUDGET` (default 16, fits the 500/month free plan) caps credits per day. Every game gets the same number of stat types, in the order of `PROPS_MARKETS` (default points, rebounds, assists, threes, PRA, ...). With 10 games and 16 credits that's points only; stats without sportsbook lines start at the player's season average and can be edited on the page.
- **Model check:** `python scripts/backtest_props_model.py 2025-26` replays a past season with the same probability model and prints accuracy and calibration.

### Betting links, phantom parlay and bet tracker

- **Bet** on any prop opens Kalshi (public API, no key or credits; `GET /props/kalshi`) and sportsbook bet-slip links from the daily lines refresh (FanDuel, DraftKings, theScore Bet).
- **+** adds a prop to the phantom parlay (saved in the browser), which shows a combined chance and grades legs after the games.
- **`/tracker`** logs real bets (from the Bet popup, the parlay slip, or by hand), auto-grades NBA legs from stored box scores via `GET /props/results`, and shows record, profit, ROI and breakdowns. Bets are stored in the browser's localStorage; use Export/Import to back up or move devices.

## Deploying

The repo needs to be on GitHub (or GitLab/Bitbucket) for both services.

**API on Render**

1. In Render, choose **New > Blueprint** and select this repo. It reads `render.yaml` and creates `gravity-score-api`.
2. Fill in `CORS_ORIGINS` with your Vercel URL once you have it (step below). `ADMIN_TOKEN` is generated for you; the other keys are optional.
3. Check `https://<your-service>.onrender.com/health` returns `{"status":"ok"}`.

The free plan sleeps after inactivity, so the first request after a while can take ~30–60 seconds.

**Website on Vercel**

1. In Vercel, **Add New > Project**, import the repo, and set **Root Directory** to `stat-miner-web`. Vite is detected automatically.
2. Add the environment variable `VITE_API_URL` = your Render URL (e.g. `https://gravity-score-api.onrender.com`).
3. Deploy, then put the Vercel URL into Render's `CORS_ORIGINS` and redeploy the API.

`stat-miner-web/vercel.json` rewrites all paths to `index.html` so links like `/players/stephen-curry` work when opened directly.

## Admin write endpoints

`POST /odds`, `POST /rankings` and `POST /tracker/bets` require the header `X-Admin-Token: <ADMIN_TOKEN>`. They're disabled if `ADMIN_TOKEN` isn't set.

## Extending with real data

- **Basketball:** Uses `nba_api` (see `backend/data_sources/nba_stats_provider.py`). Add similar providers in `backend/data_sources/` for NFL, NHL, etc., then wire them into the corresponding algorithm modules in `backend/algorithms/`.
- **Racing & fights:** Use `RaceAdapter` and `FightAdapter` in `backend/core/adapters/`. They currently use mock data; plug in live feeds or APIs by extending those adapters.

