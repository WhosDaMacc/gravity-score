import type { CSSProperties } from "react";

export type StatKey =
  | "pts" | "reb" | "ast" | "fg3m" | "pra" | "pr" | "pa" | "ra"
  | "fg3a" | "fga" | "fgm" | "fta" | "stl" | "blk" | "stocks" | "tov"
  | "pass_yds" | "rush_yds" | "rec_yds" | "receptions" | "pass_tds"
  | "rush_rec_yds";

type LogField = "min" | "pts" | "reb" | "ast" | "fgm" | "fga" | "fg3m" | "fg3a" | "ftm" | "fta" | "stl" | "blk" | "tov"
  | "pass_yds" | "pass_tds" | "pass_int" | "rush_att" | "rush_yds" | "rush_tds"
  | "rec" | "rec_yds" | "rec_tds" | "targets" | "fum_lost";

export const STATS: { key: StatKey; label: string; name: string; parts: LogField[] }[] = [
  { key: "pts", label: "PTS", name: "Points", parts: ["pts"] },
  { key: "reb", label: "REB", name: "Rebounds", parts: ["reb"] },
  { key: "ast", label: "AST", name: "Assists", parts: ["ast"] },
  { key: "fg3m", label: "3PM", name: "3-pointers made", parts: ["fg3m"] },
  { key: "pra", label: "PRA", name: "Points + rebounds + assists", parts: ["pts", "reb", "ast"] },
  { key: "pr", label: "P+R", name: "Points + rebounds", parts: ["pts", "reb"] },
  { key: "pa", label: "P+A", name: "Points + assists", parts: ["pts", "ast"] },
  { key: "ra", label: "R+A", name: "Rebounds + assists", parts: ["reb", "ast"] },
  { key: "fg3a", label: "3PA", name: "3-point attempts", parts: ["fg3a"] },
  { key: "fga", label: "FGA", name: "Field goal attempts", parts: ["fga"] },
  { key: "fgm", label: "FGM", name: "Field goals made", parts: ["fgm"] },
  { key: "fta", label: "FTA", name: "Free throw attempts", parts: ["fta"] },
  { key: "stl", label: "STL", name: "Steals", parts: ["stl"] },
  { key: "blk", label: "BLK", name: "Blocks", parts: ["blk"] },
  { key: "stocks", label: "STL+BLK", name: "Steals + blocks", parts: ["stl", "blk"] },
  { key: "tov", label: "TOV", name: "Turnovers", parts: ["tov"] },
];

export const NFL_STATS: { key: StatKey; label: string; name: string; parts: LogField[] }[] = [
  { key: "pass_yds", label: "PASS YDS", name: "Passing yards", parts: ["pass_yds"] },
  { key: "rush_yds", label: "RUSH YDS", name: "Rushing yards", parts: ["rush_yds"] },
  { key: "rec_yds", label: "REC YDS", name: "Receiving yards", parts: ["rec_yds"] },
  { key: "receptions", label: "REC", name: "Receptions", parts: ["rec"] },
  { key: "pass_tds", label: "PASS TD", name: "Passing touchdowns", parts: ["pass_tds"] },
  { key: "rush_rec_yds", label: "RUSH+REC", name: "Rushing + receiving yards", parts: ["rush_yds", "rec_yds"] },
];

export const STAT_BY_KEY = Object.fromEntries(
  [...STATS, ...NFL_STATS].map((s) => [s.key, s]),
) as Record<StatKey, (typeof STATS)[number]>;

/** Stat tabs per sport; the board's `sport` selects which set renders. */
export const SPORT_STATS: Record<string, (typeof STATS)[number][]> = {
  nba: STATS,
  nfl: NFL_STATS,
};

export const SPORT_LABELS: Record<string, string> = { nba: "NBA", nfl: "NFL" };

export type PropLine = { line: number; books: number; low: number; high: number };
type LogRow = [string, string, number, number, ...number[]];

export type PropsPlayer = {
  id: string;
  name: string;
  pos: string;
  team: string;
  opp: string;
  home: boolean;
  game_id: string;
  lines: Partial<Record<StatKey, PropLine>>;
  logs: LogRow[];
};

export type PropsGame = {
  id: string;
  start: string;
  home: string;
  away: string;
  home_name: string;
  away_name: string;
  markets: StatKey[];
};

export type PropsBoard = {
  date: string;
  sport: string;
  season: string;
  log_fields: string[];
  games: PropsGame[];
  players: PropsPlayer[];
  lines: { fetched_at: string; credits_remaining: number | null; markets: StatKey[] } | null;
  defense: DefenseProfile | null;
  unmatched_props: string[];
  logs_through: string | null;
};

type DefenseGroup = "ALL" | "G" | "F" | "C";

export type DefenseProfile = {
  season: string;
  fields: string[];
  games: Record<string, number>;
  allowed: Record<string, Record<DefenseGroup, number[]>>;
  league: Partial<Record<DefenseGroup, number[]>>;
};

export const POSITION_NAMES: Record<DefenseGroup, string> = { ALL: "all players", G: "guards", F: "forwards", C: "centers" };

export type GameLog = { date: string; opp: string; home: boolean; prevSeason: boolean; stats: Record<LogField, number> };

export function parseLogs(board: PropsBoard, player: PropsPlayer): GameLog[] {
  const fields = board.log_fields.slice(4) as LogField[];
  return player.logs.map(([date, opp, home, prev, ...values]) => ({
    date,
    opp,
    home: home === 1,
    prevSeason: prev === 1,
    stats: Object.fromEntries(fields.map((f, i) => [f, values[i]])) as Record<LogField, number>,
  }));
}

export function statValue(log: GameLog, stat: StatKey): number {
  return STAT_BY_KEY[stat].parts.reduce((sum, part) => sum + log.stats[part], 0);
}

export type HitRate = { hits: number; n: number; rate: number | null };

/** A push (value exactly on the line) counts as neither a hit nor a miss. */
export function hitRate(values: number[], line: number): HitRate {
  let hits = 0;
  let n = 0;
  for (const v of values) {
    if (v === line) continue;
    n += 1;
    if (v > line) hits += 1;
  }
  return { hits, n, rate: n ? hits / n : null };
}

export const WINDOWS = ["L5", "L10", "L20", "SZN", "H2H"] as const;
export type WindowKey = (typeof WINDOWS)[number];

const WEIGHTS: Record<WindowKey, number> = { L5: 0.25, L10: 0.3, L20: 0.2, SZN: 0.15, H2H: 0.1 };
const SHRINK_GAMES = 3;

const DEFENSE_SHRINK_GAMES = 8;

export type Matchup = {
  group: DefenseGroup;
  allowed: number;
  league: number;
  rawFactor: number;
  factor: number;
  rank: number;
  teams: number;
  games: number;
};

export function positionGroup(pos: string): DefenseGroup {
  return pos === "G" || pos === "F" || pos === "C" ? pos : "ALL";
}

/**
 * How much the opponent allows of this stat (to everyone, or to one position)
 * relative to the league. The factor is pulled toward 1.0 while the opponent
 * has few games. Rank 1 allows the least (toughest matchup).
 *
 * The probability uses the whole-team version: backtested on 2025-26 it
 * improved every stat, while the by-position version was mostly noise.
 */
export function matchupFor(defense: DefenseProfile, opp: string, group: DefenseGroup, stat: StatKey): Matchup | null {
  const idx = STAT_BY_KEY[stat].parts.map((p) => defense.fields.indexOf(p));
  const total = (vals: number[] | undefined) => (vals ? idx.reduce((s, i) => s + vals[i], 0) : null);

  const allowed = total(defense.allowed[opp]?.[group]);
  const league = total(defense.league[group]);
  if (allowed === null || !league) return null;

  const games = defense.games[opp] ?? 0;
  const rawFactor = allowed / league;
  const factor = 1 + ((rawFactor - 1) * games) / (games + DEFENSE_SHRINK_GAMES);
  const all = Object.values(defense.allowed).map((t) => total(t[group]) ?? 0);
  const rank = all.filter((v) => v < allowed).length + 1;
  return { group, allowed, league, rawFactor, factor, rank, teams: all.length, games };
}

export type Projection = { l5: number | null; l10: number | null; season: number | null; base: number; adjusted: number; sd: number };

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

export function project(logs: GameLog[], stat: StatKey, factor: number): Projection | null {
  const values = logs.map((l) => statValue(l, stat));
  if (!values.length) return null;
  const seasonVals = logs.filter((l) => !l.prevSeason).map((l) => statValue(l, stat));
  const l5 = mean(values.slice(0, 5));
  const l10 = mean(values.slice(0, 10));
  const season = mean(seasonVals);
  const parts: [number | null, number][] = [[l5, 0.2], [l10, 0.5], [season ?? mean(values.slice(0, 20)), 0.3]];
  const used = parts.filter((p): p is [number, number] => p[0] !== null);
  const base = used.reduce((s, [v, w]) => s + v * w, 0) / used.reduce((s, [, w]) => s + w, 0);

  const recent = values.slice(0, 20);
  const avg = mean(recent) ?? base;
  const sd = recent.length >= 5 ? Math.sqrt(recent.reduce((s, v) => s + (v - avg) ** 2, 0) / (recent.length - 1)) : Math.sqrt(base);
  return { l5, l10, season, base, adjusted: base * factor, sd };
}

function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Raw chances above 65% came in lower in the backtest, so the top end is compressed. */
function calibrate(p: number): number {
  return p > 0.65 ? 0.65 + (p - 0.65) * 0.4 : p;
}

const LOW_COUNT_PROJECTION = 6;

/** The game-to-game spread probOver actually uses for this projection. */
export function spreadUsed(projection: number, sd: number): number {
  return projection < LOW_COUNT_PROJECTION ? Math.sqrt(Math.max(projection, 0)) : Math.max(sd, Math.sqrt(projection));
}

/**
 * Chance of going over the line. Low-count stats (projection under 6) use a
 * Poisson model; everything else a normal curve using the player's own
 * game-to-game spread, never tighter than a Poisson's. A negative binomial
 * using the player's spread backtested worse for low counts.
 * Mirrored in stat-miner-app/scripts/backtest_props_model.py.
 */
export function probOver(projection: number, sd: number, line: number): number {
  const need = Math.floor(line) + 1;
  if (projection <= 0) return 0;
  if (projection < LOW_COUNT_PROJECTION) {
    let term = Math.exp(-projection);
    let below = 0;
    for (let k = 0; k < need; k++) {
      below += term;
      term *= projection / (k + 1);
    }
    return calibrate(Math.min(1, Math.max(0, 1 - below)));
  }
  return calibrate(1 - normalCdf((need - 0.5 - projection) / spreadUsed(projection, sd)));
}

export type PropAnalysis = {
  line: number;
  windows: Record<WindowKey, HitRate>;
  last10: { value: number; opp: string; date: string }[];
  h2hGames: { value: number; date: string; prevSeason: boolean }[];
  clear: number | null;
  seasonGames: number;
  matchup: Matchup | null;
  positionMatchup: Matchup | null;
  projection: Projection | null;
  prob: number | null;
};

export function defaultLine(logs: GameLog[], stat: StatKey): number {
  const season = logs.filter((l) => !l.prevSeason);
  const pool = season.length ? season : logs;
  if (!pool.length) return 0.5;
  const avg = pool.reduce((s, l) => s + statValue(l, stat), 0) / pool.length;
  return Math.floor(avg) + 0.5;
}

/**
 * Clear % blends the windows (recent games weigh most), with head-to-head
 * weighted down when there are fewer than 3 meetings, then shrinks toward 50%
 * when the last-10 sample is small.
 */
export function analyze(
  logs: GameLog[],
  stat: StatKey,
  line: number,
  opp: string,
  matchup: Matchup | null,
  positionMatchup: Matchup | null = null,
): PropAnalysis {
  const values = logs.map((l) => statValue(l, stat));
  const season = logs.filter((l) => !l.prevSeason).map((l) => statValue(l, stat));
  const h2h = logs.filter((l) => l.opp === opp).map((l) => statValue(l, stat));
  const windows: Record<WindowKey, HitRate> = {
    L5: hitRate(values.slice(0, 5), line),
    L10: hitRate(values.slice(0, 10), line),
    L20: hitRate(values.slice(0, 20), line),
    SZN: hitRate(season, line),
    H2H: hitRate(h2h, line),
  };

  let weighted = 0;
  let total = 0;
  for (const w of WINDOWS) {
    const { rate, n } = windows[w];
    if (rate === null) continue;
    const weight = w === "H2H" ? WEIGHTS.H2H * Math.min(n, 3) / 3 : WEIGHTS[w];
    weighted += weight * rate;
    total += weight;
  }
  const sample = windows.L10.n;
  const clear = total ? (weighted / total * sample + 0.5 * SHRINK_GAMES) / (sample + SHRINK_GAMES) : null;
  const last10 = logs.slice(0, 10).map((l) => ({ value: statValue(l, stat), opp: l.opp, date: l.date }));
  const h2hGames = logs
    .filter((l) => l.opp === opp)
    .map((l) => ({ value: statValue(l, stat), date: l.date, prevSeason: l.prevSeason }));
  const projection = project(logs, stat, matchup?.factor ?? 1);

  return {
    line,
    windows,
    last10,
    h2hGames,
    clear,
    seasonGames: season.length,
    matchup,
    positionMatchup,
    projection,
    prob: projection ? probOver(projection.adjusted, projection.sd, line) : null,
  };
}

export function heatStyle(rate: number | null): CSSProperties {
  if (rate === null) return { backgroundColor: "rgb(30 41 59 / 0.4)", color: "rgb(100 116 139)" };
  const hue = Math.round(rate * 125);
  const strength = 0.25 + Math.abs(rate - 0.5) * 1.1;
  return { backgroundColor: `hsl(${hue} 70% 38% / ${strength})`, color: "white" };
}

export function lean(chance: number | null): "Over" | "Under" | null {
  if (chance === null) return null;
  if (chance >= 0.62) return "Over";
  if (chance <= 0.38) return "Under";
  return null;
}

/** Matchup badge colors from the over bettor's view: soft defense is green. */
export function matchupTone(m: Matchup | null): string {
  if (!m) return "bg-slate-800 text-slate-400";
  if (m.factor >= 1.03) return "bg-emerald-500/15 text-emerald-300";
  if (m.factor <= 0.97) return "bg-rose-500/15 text-rose-300";
  return "bg-slate-700/60 text-slate-300";
}
