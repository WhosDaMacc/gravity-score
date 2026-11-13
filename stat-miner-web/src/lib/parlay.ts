import { useSyncExternalStore } from "react";
import type { Side, StatKey } from "./props";

export type ParlayLeg = {
  id: string;
  /** "nba" or "nfl"; legs saved before sports were tracked are NBA. */
  sport?: string;
  date: string;
  playerId: string;
  name: string;
  team: string;
  opp: string;
  stat: StatKey;
  line: number;
  side: Side;
  /** Chance of the over when the leg was added; the slip recalculates when it can. */
  probOver: number | null;
};

const STORAGE_KEY = "gravityscore.phantomParlay.v1";
const listeners = new Set<() => void>();

function read(): ParlayLeg[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let legs: ParlayLeg[] = read();

function write(next: ParlayLeg[]) {
  legs = next;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  listeners.forEach((l) => l());
}

window.addEventListener("storage", (e) => {
  if (e.key === STORAGE_KEY) {
    legs = read();
    listeners.forEach((l) => l());
  }
});

export const legId = (date: string, playerId: string, stat: StatKey) => `${date}:${playerId}:${stat}`;

export const parlay = {
  /** Adding the same player and stat again replaces the earlier leg. */
  add(leg: Omit<ParlayLeg, "id">) {
    const id = legId(leg.date, leg.playerId, leg.stat);
    write([...legs.filter((l) => l.id !== id), { ...leg, id }]);
  },
  remove(id: string) {
    write(legs.filter((l) => l.id !== id));
  },
  setSide(id: string, side: Side) {
    write(legs.map((l) => (l.id === id ? { ...l, side } : l)));
  },
  clear() {
    write([]);
  },
};

export function useParlay(): ParlayLeg[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => legs,
  );
}
