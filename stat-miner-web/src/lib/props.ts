import type { CSSProperties } from "react";

export type StatKey =
  | "pts" | "reb" | "ast" | "fg3m" | "pra" | "pr" | "pa" | "ra"
  | "fg3a" | "fga" | "fgm" | "fta" | "stl" | "blk" | "stocks" | "tov";

type LogField = "min" | "pts" | "reb" | "ast" | "fgm" | "fga" | "fg3m" | "fg3a" | "ftm" | "fta" | "stl" | "blk" | "tov";

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

export const STAT_BY_KEY = Object.fromEntries(STATS.map((s) => [s.key, s])) as Record<StatKey, (typeof STATS)[number]>;

export type PropLine = { line: number; books: number; low: number; high: number };
type LogRow = [string, string, number, number, ...number[]];

export type PropsPlayer = {
  id: string;
  name: string;
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
  season: string;
  log_fields: string[];
  games: PropsGame[];
  players: PropsPlayer[];
  lines: { fetched_at: string; credits_remaining: number | null; markets: StatKey[] } | null;
  unmatched_props: string[];
  logs_through: string | null;
};

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

export type PropAnalysis = {
  line: number;
  windows: Record<WindowKey, HitRate>;
  last10: { value: number; opp: string; date: string }[];
  avg10: number | null;
  clear: number | null;
  seasonGames: number;
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
export function analyze(logs: GameLog[], stat: StatKey, line: number, opp: string): PropAnalysis {
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

  return {
    line,
    windows,
    last10,
    avg10: last10.length ? last10.reduce((s, g) => s + g.value, 0) / last10.length : null,
    clear,
    seasonGames: season.length,
  };
}

export function heatStyle(rate: number | null): CSSProperties {
  if (rate === null) return { backgroundColor: "rgb(30 41 59 / 0.4)", color: "rgb(100 116 139)" };
  const hue = Math.round(rate * 125);
  const strength = 0.25 + Math.abs(rate - 0.5) * 1.1;
  return { backgroundColor: `hsl(${hue} 70% 38% / ${strength})`, color: "white" };
}

export function lean(clear: number | null): "Over" | "Under" | null {
  if (clear === null) return null;
  if (clear >= 0.62) return "Over";
  if (clear <= 0.38) return "Under";
  return null;
}
