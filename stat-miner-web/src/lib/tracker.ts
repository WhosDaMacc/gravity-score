import { useSyncExternalStore } from "react";
import { getJson } from "./api";
import { STAT_BY_KEY, type Side, type StatKey } from "./props";

export type TrackedLeg = {
  /** ESPN athlete id; legs without one can't be auto-graded. */
  playerId?: string;
  name: string;
  team?: string;
  opp?: string;
  stat: StatKey;
  line: number;
  side: Side;
  date: string;
  /** Our model's chance of the over when the bet was logged. */
  probOver?: number | null;
};

export type BetResult = "won" | "lost" | "push" | "void";

export type TrackedBet = {
  id: string;
  placedAt: string;
  book: string;
  stake: number;
  /** American odds for the whole bet (parlay odds for parlays). */
  odds: number;
  legs: TrackedLeg[];
  manualResult?: BetResult | null;
  note?: string;
};

const STORAGE_KEY = "gravityscore.bets.v1";
const listeners = new Set<() => void>();

function read(): TrackedBet[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let bets: TrackedBet[] = read();

function write(next: TrackedBet[]) {
  bets = next;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  listeners.forEach((l) => l());
}

window.addEventListener("storage", (e) => {
  if (e.key === STORAGE_KEY) {
    bets = read();
    listeners.forEach((l) => l());
  }
});

export const tracker = {
  add(bet: Omit<TrackedBet, "id" | "placedAt">) {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    write([{ ...bet, id, placedAt: new Date().toISOString() }, ...bets]);
  },
  update(id: string, changes: Partial<TrackedBet>) {
    write(bets.map((b) => (b.id === id ? { ...b, ...changes } : b)));
  },
  remove(id: string) {
    write(bets.filter((b) => b.id !== id));
  },
  /** Merge an exported file; bets with an id already present are skipped. */
  importBets(incoming: TrackedBet[]): number {
    const known = new Set(bets.map((b) => b.id));
    const fresh = incoming.filter((b) => b && b.id && Array.isArray(b.legs) && !known.has(b.id));
    write([...fresh, ...bets].sort((a, b) => b.placedAt.localeCompare(a.placedAt)));
    return fresh.length;
  },
};

export function useBets(): TrackedBet[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => bets,
  );
}

export function americanToDecimal(odds: number): number {
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
}

/** Unrounded, so payouts stay exact; round only for display (formatOdds). */
export function decimalToAmerican(decimal: number): number {
  return decimal >= 2 ? (decimal - 1) * 100 : -100 / (decimal - 1);
}

export function formatOdds(american: number): string {
  const rounded = Math.round(american);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

/** A Kalshi contract bought at `cents` pays $1, so 54¢ is decimal 1/0.54. */
export function kalshiCentsToAmerican(cents: number): number {
  return decimalToAmerican(100 / cents);
}

export function parlayAmerican(legOdds: number[]): number {
  return decimalToAmerican(legOdds.reduce((acc, o) => acc * americanToDecimal(o), 1));
}

/** Box-score lines by "playerId:date", from /props/results. */
export type GameResults = { fields: string[]; results: Record<string, number[] | null> };

export type LegOutcome = "won" | "lost" | "push" | null;

export function legOutcome(leg: TrackedLeg, results: GameResults | null): LegOutcome {
  if (!leg.playerId || !results) return null;
  const row = results.results[`${leg.playerId}:${leg.date}`];
  if (!row) return null;
  const value = STAT_BY_KEY[leg.stat].parts.reduce((s, part) => s + row[results.fields.indexOf(part)], 0);
  if (value === leg.line) return "push";
  return (value > leg.line) === (leg.side === "Over") ? "won" : "lost";
}

export type Settlement = { result: BetResult | "pending" | "review"; profit: number };

/**
 * A manual result always wins. Otherwise any lost leg loses the bet; all legs
 * pushed is a push; a parlay that won with a pushed leg pays reduced odds the
 * books calculate differently, so it's flagged for the user to settle.
 */
export function settle(bet: TrackedBet, outcomes: LegOutcome[]): Settlement {
  const result = bet.manualResult ?? autoResult(outcomes);
  if (result === "won") return { result, profit: bet.stake * (americanToDecimal(bet.odds) - 1) };
  if (result === "lost") return { result, profit: -bet.stake };
  return { result, profit: 0 };
}

function autoResult(outcomes: LegOutcome[]): Settlement["result"] {
  if (outcomes.includes("lost")) return "lost";
  if (outcomes.includes(null)) return "pending";
  if (outcomes.every((o) => o === "push")) return "push";
  return outcomes.includes("push") ? "review" : "won";
}

/** Fetch box scores for every gradeable leg whose game day has passed. */
export async function fetchResults(allBets: TrackedBet[], today: string): Promise<GameResults> {
  const keys = [
    ...new Set(
      allBets.flatMap((b) => b.legs).filter((l) => l.playerId && l.date < today).map((l) => `${l.playerId}:${l.date}`),
    ),
  ];
  const merged: GameResults = { fields: [], results: {} };
  for (let i = 0; i < keys.length; i += 30) {
    const chunk = await getJson<GameResults>(`/props/results?keys=${encodeURIComponent(keys.slice(i, i + 30).join(","))}`);
    merged.fields = chunk.fields;
    Object.assign(merged.results, chunk.results);
  }
  return merged;
}

export function todayEastern(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

export const BOOK_OPTIONS = ["Kalshi", "DraftKings", "FanDuel", "theScore Bet", "Caesars", "BetMGM", "Fanatics", "BetRivers", "PrizePicks", "Underdog", "Other"];

export function money(n: number): string {
  const sign = n < 0 ? "−" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

export function legLabel(leg: TrackedLeg): string {
  return `${leg.name} ${leg.side === "Over" ? "O" : "U"} ${leg.line} ${STAT_BY_KEY[leg.stat].label}`;
}

export function toCsv(allBets: TrackedBet[], settlements: Map<string, Settlement>): string {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = [["placed", "game date", "book", "legs", "stake", "odds", "result", "profit"]];
  for (const b of allBets) {
    const s = settlements.get(b.id);
    rows.push([
      new Date(b.placedAt).toLocaleDateString("en-CA"), b.legs[0]?.date ?? "", b.book, b.legs.map(legLabel).join(" + "),
      String(b.stake), formatOdds(b.odds), s?.result ?? "", s ? s.profit.toFixed(2) : "",
    ]);
  }
  return rows.map((r) => r.map(esc).join(",")).join("\n");
}
