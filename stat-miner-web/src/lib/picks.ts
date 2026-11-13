import { slugify } from "./format";
import {
  analyze,
  defaultLine,
  matchupFor,
  parseLogs,
  statValue,
  STAT_BY_KEY,
  SPORT_STATS,
  type HitRate,
  type PropsBoard,
  type StatKey,
  type WindowKey,
} from "./props";

/**
 * Suggested bets engine: turns a props board into ranked single suggestions
 * and premade Safe / Moderate / Risky parlays, using the same blended Clear %
 * hit rates as the Props page (see analyze() in props.ts).
 *
 * These are suggestions built from PAST hit rates. Nothing here is a promise:
 * a high Clear % means a player cleared this line often recently, not that
 * they will tonight. Parlay "combined" numbers multiply the leg estimates,
 * which assumes the legs are independent — they aren't, perfectly — and are
 * always labelled as estimates.
 */

export type Direction = "Over" | "Under";
export type TierKey = "safe" | "moderate" | "risky";

export type Pick = {
  /** playerId + stat, unique within a board. */
  key: string;
  playerId: string;
  playerName: string;
  team: string;
  opp: string;
  home: boolean;
  gameId: string;
  stat: StatKey;
  statLabel: string;
  statName: string;
  line: number;
  direction: Direction;
  /** Hit-rate estimate for the suggested side: Clear % for Over, 1 − Clear % for Under. */
  estimate: number;
  /** Blended over-rate from analyze(). */
  clear: number;
  windows: Record<WindowKey, HitRate>;
  seasonGames: number;
  lineSource: "book" | "avg";
  books: number | null;
  /** Higher-variance leg type (NFL passing TDs, NBA PRA) — the Risky tier's swing leg. */
  swing: boolean;
};

export type Parlay = {
  id: string;
  tier: TierKey;
  legs: Pick[];
  combined: number;
};

export type PicksResult = {
  sport: string;
  date: string;
  /** True when at least one real sportsbook line is loaded on this board. */
  hasBookLines: boolean;
  singles: Pick[];
  parlays: Record<TierKey, Parlay[]>;
  /** Why a tier has no parlay, or null when it does. Never padded silently. */
  shortfalls: Record<TierKey, string | null>;
  /** Props that passed the sample bar, before the singles display cutoff. */
  poolSize: number;
};

/** Sample bar every suggestion must clear: real season + recent sample. */
export const MIN_SEASON_GAMES = 5;
export const MIN_L10_SAMPLE = 5;
/**
 * The player must actually produce the stat: at least this many season games
 * recording a value above zero. Without it, average-derived lines manufacture
 * fake "locks" — "Under 0.5 3PM" for centers who never shoot threes, or
 * "Under 0.5 pass yards" for running backs. Those aren't real props.
 */
export const MIN_ACTIVE_GAMES = 3;
/** Lowest directional estimate that enters the parlay pool at all (the Risky floor). */
const POOL_MIN_ESTIMATE = 0.52;
/** Display cutoff for the ranked singles list. */
export const SINGLES_MIN_ESTIMATE = 0.58;
const MAX_SINGLES = 20;
const MAX_SINGLES_PER_PLAYER = 2;
const MAX_PARLAYS_PER_TIER = 3;

const SWING_STATS: StatKey[] = ["pass_tds", "pra"];

export type TierSpec = {
  key: TierKey;
  label: string;
  legCounts: number[];
  minEstimate: number;
  maxPerGame: number;
  note: string;
};

export const TIER_SPECS: Record<TierKey, TierSpec> = {
  safe: {
    key: "safe",
    label: "Safe",
    legCounts: [2],
    minEstimate: 0.7,
    maxPerGame: 1,
    note: "2 legs, each with a 70%+ hit-rate estimate, from different games.",
  },
  moderate: {
    key: "moderate",
    label: "Moderate",
    legCounts: [3],
    minEstimate: 0.6,
    maxPerGame: 2,
    note: "3 legs, each with a 60%+ hit-rate estimate.",
  },
  risky: {
    key: "risky",
    label: "Risky",
    legCounts: [5, 4],
    minEstimate: 0.52,
    maxPerGame: 2,
    note: "4–5 legs, each 52%+. May include one higher-variance swing leg.",
  },
};

export const TIER_ORDER: TierKey[] = ["safe", "moderate", "risky"];

/** Hit rate for the side a pick actually suggests (Under flips the over-rate). */
export function directionalRate(hr: HitRate, direction: Direction): number | null {
  if (hr.rate === null) return null;
  return direction === "Over" ? hr.rate : 1 - hr.rate;
}

/** Hits for the suggested side: for an Under, the hits are the non-overs (pushes excluded). */
export function directionalHits(hr: HitRate, direction: Direction): number {
  return direction === "Over" ? hr.hits : hr.n - hr.hits;
}

/** The same pick, flipped to the other side. The faded estimate is 1 − estimate. */
export function flipPick(pick: Pick): Pick {
  return {
    ...pick,
    direction: pick.direction === "Over" ? "Under" : "Over",
    estimate: 1 - pick.estimate,
  };
}

/** Combined estimate for a set of legs: product of the leg estimates (independence assumed). */
export function combinedEstimate(legs: Pick[]): number {
  return legs.reduce((p, leg) => p * leg.estimate, 1);
}

export function pickText(pick: Pick): string {
  return `${pick.playerName} ${pick.direction} ${pick.line} ${pick.statLabel}`;
}

export function parlaySlip(parlay: Parlay, sportLabel: string, dateLabel: string, legs: Pick[] = parlay.legs): string {
  const tier = TIER_SPECS[parlay.tier].label;
  const lines = [
    `Gravity Score — ${tier} parlay (${sportLabel}, ${dateLabel})`,
    ...legs.map((leg) => `${pickText(leg)} — hit-rate est. ${Math.round(leg.estimate * 100)}%`),
    `Combined estimate ~${Math.round(combinedEstimate(legs) * 100)}% — estimate only; legs assumed independent; parlays are hard to hit.`,
    "Suggestion only — not a guarantee.",
  ];
  return lines.join("\n");
}

/**
 * Every prop on the board that passes the sample bar, best directional
 * estimate first. This is the single candidate-generation path for every
 * surface: suggested bets, parlays, the ticker, and each player's Lean.
 */
export function buildCandidatePool(board: PropsBoard): Pick[] {
  const stats = SPORT_STATS[board.sport] ?? SPORT_STATS.nba;
  const hasBookLines = board.players.some((p) => Object.keys(p.lines).length > 0);
  const pool: Pick[] = [];

  for (const player of board.players) {
    const logs = parseLogs(board, player);
    if (!logs.length) continue;
    for (const statDef of stats) {
      const stat = statDef.key;
      const book = player.lines[stat];
      // When books have posted lines for this slate, suggestions only use real
      // book lines. Average-derived lines are only used when no book lines
      // exist at all, and the page stamps that clearly.
      if (hasBookLines && !book) continue;
      const line = book?.line ?? defaultLine(logs, stat);
      const activeGames = logs.filter((l) => !l.prevSeason && statValue(l, stat) > 0).length;
      if (activeGames < MIN_ACTIVE_GAMES) continue;
      const matchup = board.defense ? matchupFor(board.defense, player.opp, "ALL", stat) : null;
      const a = analyze(logs, stat, line, player.opp, matchup);
      if (a.clear === null) continue;
      if (a.seasonGames < MIN_SEASON_GAMES) continue;
      if (a.windows.L10.n < MIN_L10_SAMPLE) continue;
      const direction: Direction = a.clear >= 0.5 ? "Over" : "Under";
      const estimate = direction === "Over" ? a.clear : 1 - a.clear;
      if (estimate < POOL_MIN_ESTIMATE) continue;
      pool.push({
        key: `${player.id}:${stat}`,
        playerId: player.id,
        playerName: player.name,
        team: player.team,
        opp: player.opp,
        home: player.home,
        gameId: player.game_id,
        stat,
        statLabel: STAT_BY_KEY[stat].label,
        statName: STAT_BY_KEY[stat].name,
        line,
        direction,
        estimate,
        clear: a.clear,
        windows: a.windows,
        seasonGames: a.seasonGames,
        lineSource: book ? "book" : "avg",
        books: book?.books ?? null,
        swing: SWING_STATS.includes(stat),
      });
    }
  }

  return pool.sort(byEstimate);
}

function fitsTier(legs: Pick[], candidate: Pick, spec: TierSpec): boolean {
  if (legs.some((l) => l.playerId === candidate.playerId)) return false;
  const inGame = legs.filter((l) => l.gameId === candidate.gameId).length;
  return inGame < spec.maxPerGame;
}

function greedyFill(eligible: Pick[], legCount: number, spec: TierSpec, seed: Pick[] = []): Pick[] {
  const legs = [...seed];
  for (const candidate of eligible) {
    if (legs.length >= legCount) break;
    if (legs.some((l) => l.key === candidate.key)) continue;
    if (fitsTier(legs, candidate, spec)) legs.push(candidate);
  }
  return legs;
}

function buildTierParlays(pool: Pick[], spec: TierSpec): Parlay[] {
  const eligible = pool.filter((p) => p.estimate >= spec.minEstimate);
  const parlays: Parlay[] = [];
  const seen = new Set<string>();

  const add = (legs: Pick[]) => {
    if (!spec.legCounts.includes(legs.length)) return;
    const signature = legs.map((l) => l.key).sort().join("|");
    if (seen.has(signature)) return;
    seen.add(signature);
    parlays.push({
      id: `${spec.key}-${parlays.length + 1}`,
      tier: spec.key,
      legs,
      combined: combinedEstimate(legs),
    });
  };

  for (const legCount of spec.legCounts) {
    if (eligible.length < legCount) continue;
    // First pass: the straight greedy best.
    add(greedyFill(eligible, legCount, spec));
    // Risky gets one variant built around the best available swing leg.
    if (spec.key === "risky") {
      const swing = eligible.find((p) => p.swing);
      if (swing) add(greedyFill(eligible, legCount, spec, [swing]));
    }
    // Alternatives: drop the top pick(s) and rebuild, for a different mix.
    for (let drop = 1; drop < eligible.length && parlays.length < MAX_PARLAYS_PER_TIER; drop++) {
      add(greedyFill(eligible.slice(drop), legCount, spec));
    }
    if (parlays.length) break; // longer leg count filled; don't also emit the shorter one
  }

  return parlays.sort((a, b) => b.combined - a.combined).slice(0, MAX_PARLAYS_PER_TIER);
}

function shortfallReason(pool: Pick[], spec: TierSpec, parlays: Parlay[]): string | null {
  if (parlays.length) return null;
  const legCount = spec.legCounts[spec.legCounts.length - 1];
  const eligible = pool.filter((p) => p.estimate >= spec.minEstimate);
  if (!pool.length) {
    return "No props passed the sample bar today (5+ season games and 5+ last-10 games), so there is nothing honest to build from.";
  }
  if (eligible.length < legCount) {
    return `Only ${eligible.length} prop${eligible.length === 1 ? "" : "s"} cleared the ${Math.round(spec.minEstimate * 100)}% bar for this tier (needs ${legCount} legs). We won't pad a parlay with weaker legs.`;
  }
  return `Enough props cleared the bar, but they were too concentrated in the same games or on the same players to build a ${legCount}-leg parlay under this tier's rules.`;
}

/**
 * A player's Lean tonight: their strongest qualifying prop — the suggestion
 * with the highest directional hit-rate estimate among the props that pass
 * the same sample bars as every other suggestion. Gravity (in api.ts /
 * gravity.py) is the pull a player puts on a defense; a Lean is how often
 * their recent games would have cleared tonight's line. It is a hit-rate
 * estimate from past games, never a win probability and never a guarantee.
 */
export const LEAN_EXPLAINER =
  "Gravity is the pull a player puts on a defense. Lean is how often their recent games would have cleared tonight's line. High gravity + high lean is who we lean on.";

const byEstimate = (a: Pick, b: Pick): number =>
  b.estimate - a.estimate || b.windows.L10.n - a.windows.L10.n || a.playerName.localeCompare(b.playerName);

/** Every player's qualifying props tonight, grouped by board player id, best estimate first. */
export function leansByPlayer(board: PropsBoard): Map<string, Pick[]> {
  const byPlayer = new Map<string, Pick[]>();
  for (const pick of buildCandidatePool(board)) {
    const list = byPlayer.get(pick.playerId);
    if (list) list.push(pick);
    else byPlayer.set(pick.playerId, [pick]);
  }
  return byPlayer;
}

/** One Lean per player with a game on this board: their strongest qualifying prop, best first. */
export function playerLeans(board: PropsBoard): Pick[] {
  const leans: Pick[] = [];
  for (const list of leansByPlayer(board).values()) leans.push(list[0]);
  return leans.sort(byEstimate);
}

/** The Lean for one board player, or undefined when they have no qualifying prop tonight. */
export function strongestLean(board: PropsBoard, playerId: string): Pick | undefined {
  return leansByPlayer(board).get(playerId)?.[0];
}

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/**
 * Join key for matching a board player's name to a leaderboard/profile slug.
 * The two sources disagree on generational suffixes — the board says "Bobby
 * Portis" where the leaderboard slug is "bobby-portis-jr", and "Scotty
 * Pippen Jr." where the slug drops it — so the key is the slugified name
 * with trailing suffixes stripped. Callers must only use a key match when it
 * is unique on both sides; exact slug matches always win.
 */
export function playerNameKey(nameOrSlug: string): string {
  const parts = slugify(nameOrSlug).split("-").filter(Boolean);
  while (parts.length > 1 && NAME_SUFFIXES.has(parts[parts.length - 1])) parts.pop();
  return parts.join("-");
}

export function buildPicks(board: PropsBoard): PicksResult {
  const pool = buildCandidatePool(board);

  const perPlayer = new Map<string, number>();
  const singles: Pick[] = [];
  for (const pick of pool) {
    if (singles.length >= MAX_SINGLES) break;
    if (pick.estimate < SINGLES_MIN_ESTIMATE) continue;
    const count = perPlayer.get(pick.playerId) ?? 0;
    if (count >= MAX_SINGLES_PER_PLAYER) continue;
    perPlayer.set(pick.playerId, count + 1);
    singles.push(pick);
  }

  const parlays = {} as Record<TierKey, Parlay[]>;
  const shortfalls = {} as Record<TierKey, string | null>;
  for (const key of TIER_ORDER) {
    parlays[key] = buildTierParlays(pool, TIER_SPECS[key]);
    shortfalls[key] = shortfallReason(pool, TIER_SPECS[key], parlays[key]);
  }

  return {
    sport: board.sport,
    date: board.date,
    hasBookLines: board.players.some((p) => Object.keys(p.lines).length > 0),
    singles,
    parlays,
    shortfalls,
    poolSize: pool.length,
  };
}
