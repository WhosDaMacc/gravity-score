import { getJson } from "./api";
import type { TierKey } from "./picks";

/**
 * Types for GET /picks/history — the public track record of Gravity Score's
 * own suggested bets. Shapes mirror stat-miner-app/backend/core/
 * picks_history.py exactly (history() / _day_summary() / _aggregate()):
 *
 * - A pick's `result` is null while its game hasn't been graded; there is
 *   no "pending" string — pending is counted in the aggregates instead.
 * - A parlay's combined estimate field is `combined` (a fraction).
 * - Days come back oldest-first (`since` is days[0]); pages reverse them.
 */

export type PickResult = "hit" | "miss" | "push" | "void";

export type HistoryPick = {
  player: string;
  player_id: string;
  team: string;
  opp: string;
  game_id: string;
  /** Stat key, e.g. "stl" / "fg3m" / "pass_yds" — labels live in STAT_BY_KEY. */
  stat: string;
  line: number;
  direction: "Over" | "Under";
  /** Directional hit-rate estimate (fraction) at publish time. */
  estimate: number;
  line_source: "book" | "avg";
  /** Actual stat total once graded; null before that (and for voids). */
  actual: number | null;
  result: PickResult | null;
};

export type HistoryParlay = {
  id: string;
  tier: TierKey;
  /** Combined estimate (fraction) — product of the leg estimates. */
  combined: number;
  legs: HistoryPick[];
  result: PickResult | null;
};

export type RecordAggregate = {
  /** Graded picks only: hits + misses + pushes + voids. */
  n: number;
  hits: number;
  misses: number;
  pushes: number;
  voids: number;
  pending: number;
  /** hits / (hits + misses); pushes and voids excluded. Null until a pick is decided. */
  hit_rate: number | null;
};

export type ParlaysByTier<T> = Record<TierKey, T>;

export type HistoryDay = {
  date: string;
  lines_mode: "book" | "avg";
  final: boolean;
  generated_at: string | null;
  graded_at: string | null;
  singles: RecordAggregate;
  parlays: ParlaysByTier<RecordAggregate>;
  detail: {
    singles: HistoryPick[];
    parlays: ParlaysByTier<HistoryParlay[]>;
  };
};

export type PicksHistory = {
  sport: string;
  /** First tracked day (YYYY-MM-DD), or null when nothing is tracked yet. */
  since: string | null;
  days: HistoryDay[];
  totals: {
    singles: RecordAggregate;
    parlays: ParlaysByTier<RecordAggregate> & { all: RecordAggregate };
  };
};

export function loadPicksHistory(sport: string): Promise<PicksHistory> {
  return getJson<PicksHistory>(`/picks/history?sport=${encodeURIComponent(sport)}`);
}
