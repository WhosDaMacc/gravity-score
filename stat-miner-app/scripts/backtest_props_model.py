"""
Backtest the props heat map's probability model on a stored season.

For every player-game after the warm-up date, it predicts the chance of going
over a line of floor(L10 average) + 0.5 using only earlier games, mirroring the
frontend model (stat-miner-web/src/lib/props.ts), with and without the
opponent-defense matchup adjustment (team overall vs by position, at two
shrinkage strengths), and with a negative binomial instead of Poisson for
low-count stats. Prints Brier score and calibration.

    python scripts/backtest_props_model.py 2025-26
"""

import math
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.data_sources import espn_boxscores as espn  # noqa: E402

STATS = {"pts": ["pts"], "reb": ["reb"], "ast": ["ast"], "fg3m": ["fg3m"], "pra": ["pts", "reb", "ast"]}
WARMUP = "-12-01"
DEFENSE_SHRINK_GAMES = 8
MIN_PRIOR_GAMES = 10
MIN_AVG_MINUTES = 20
VARIANTS = [("position k=8", None, 8), ("position k=30", None, 30), ("team k=30", "ALL", 30)]


def normal_cdf(z: float) -> float:
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


def calibrate(p: float) -> float:
    return 0.65 + (p - 0.65) * 0.4 if p > 0.65 else p


def count_prob_over(mean: float, variance: float, need: int) -> float:
    """P(X >= need): negative binomial when the player is streakier than Poisson, else Poisson."""
    if variance > mean * 1.05:
        r = mean * mean / (variance - mean)
        p = r / (r + mean)
        term, below = p ** r, 0.0
        for k in range(need):
            below += term
            term *= (k + r) / (k + 1) * (1 - p)
    else:
        term, below = math.exp(-mean), 0.0
        for k in range(need):
            below += term
            term *= mean / (k + 1)
    return min(1.0, max(0.0, 1 - below))


def prob_over(projection: float, sd: float, line: float, low_model: str = "poisson") -> float:
    need = math.floor(line) + 1
    if projection <= 0:
        return 0.0
    if projection < 6:
        variance = sd * sd if low_model == "negbin" else projection
        return calibrate(count_prob_over(projection, variance, need))
    return calibrate(1 - normal_cdf((need - 0.5 - projection) / max(sd, math.sqrt(projection))))


def main() -> None:
    season = sys.argv[1] if len(sys.argv) > 1 else "2025-26"
    games, positions = espn.season_games(season)
    idx = {f: i for i, f in enumerate(espn.STAT_FIELDS)}
    warmup = f"{season[:4]}{WARMUP}"

    history = defaultdict(list)  # athlete -> list of stat rows, oldest first
    allowed = defaultdict(lambda: defaultdict(lambda: [0.0] * len(idx)))  # team -> group -> sums
    team_games = defaultdict(int)
    results = {stat: {"with": [], "without": []} for stat in STATS}

    for game in sorted(games.values(), key=lambda g: g["date"]):
        home, away = game["home"], game["away"]
        league = defaultdict(lambda: [0.0] * len(idx))
        total_games = sum(team_games.values())
        for by_group in allowed.values():
            for g, vals in by_group.items():
                league[g] = [a + b for a, b in zip(league[g], vals)]

        for athlete_id, _name, team, *stats in game["players"]:
            past = history[athlete_id]
            if game["date"] >= warmup and len(past) >= MIN_PRIOR_GAMES:
                recent = past[-10:]
                if sum(r[idx["min"]] for r in recent) / len(recent) >= MIN_AVG_MINUTES:
                    opp = away if team == home else home
                    group = positions.get(athlete_id, "") or "ALL"
                    for stat, parts in STATS.items():
                        val = lambda row: sum(row[idx[p]] for p in parts)  # noqa: E731
                        values = [val(r) for r in reversed(past)]
                        l5, l10, szn = (sum(v) / len(v) for v in (values[:5], values[:10], values))
                        base = 0.2 * l5 + 0.5 * l10 + 0.3 * szn
                        r20 = values[:20]
                        avg = sum(r20) / len(r20)
                        sd = math.sqrt(sum((v - avg) ** 2 for v in r20) / (len(r20) - 1))
                        line = math.floor(l10) + 0.5

                        n = team_games.get(opp, 0)

                        def factor_for(g: str, shrink: int) -> float:
                            if not (n and total_games and g in league):
                                return 1.0
                            opp_allowed = sum(allowed[opp][g][idx[p]] for p in parts) / n
                            league_avg = sum(league[g][idx[p]] for p in parts) / total_games
                            if league_avg <= 0:
                                return 1.0
                            return 1 + (opp_allowed / league_avg - 1) * n / (n + shrink)

                        actual = val(stats)
                        if actual == line:
                            continue
                        hit = 1.0 if actual > line else 0.0
                        results[stat]["with"].append((prob_over(base * factor_for("ALL", DEFENSE_SHRINK_GAMES), sd, line), hit))
                        results[stat]["without"].append((prob_over(base, sd, line), hit))
                        results[stat].setdefault("negbin low", []).append(
                            (prob_over(base * factor_for("ALL", DEFENSE_SHRINK_GAMES), sd, line, "negbin"), hit)
                        )
                        for name, g, shrink in VARIANTS:
                            results[stat].setdefault(name, []).append(
                                (prob_over(base * factor_for(g or group, shrink), sd, line), hit)
                            )

        for athlete_id, _name, team, *stats in game["players"]:
            history[athlete_id].append(stats)
            defender = away if team == home else home
            group = positions.get(athlete_id, "")
            for g in ("ALL", group) if group in ("G", "F", "C") else ("ALL",):
                allowed[defender][g] = [a + b for a, b in zip(allowed[defender][g], stats)]
        team_games[home] += 1
        team_games[away] += 1

    def brier(pairs):
        return sum((p - y) ** 2 for p, y in pairs) / len(pairs)

    print(f"Season {season}, predictions from {warmup}, line = floor(L10 avg) + 0.5\n")
    names = ["without", "with", "negbin low", *[v[0] for v in VARIANTS]]
    print("Brier score (lower is better; coin flip = 0.2500). 'with' = team defense, k=8 (the live model)")
    print(f"{'':6s}" + "".join(f"{n:>14s}" for n in names))
    for stat, r in results.items():
        print(f"{stat.upper():6s}" + "".join(f"{brier(r[n]):14.4f}" for n in names))
    print("\nCalibration with matchup, all stats (predicted -> actual over rate):")
    pooled = [pair for r in results.values() for pair in r["with"]]
    for lo in [0.0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]:
        hi = {0.0: 0.2, 0.8: 1.01}.get(lo, lo + 0.1)
        bucket = [y for p, y in pooled if lo <= p < hi]
        if bucket:
            print(f"  {lo:.0%}-{min(hi, 1):.0%}: {sum(bucket) / len(bucket):.1%} over  (n={len(bucket)})")


if __name__ == "__main__":
    main()
