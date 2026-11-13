import React, { useEffect, useState } from "react";
import { getJson } from "../lib/api";
import { autoGrades } from "../lib/tracker";
import LogBetForm from "./LogBetForm";
import { parlay, type ParlayLeg } from "../lib/parlay";
import {
  fairOdds,
  kalshiFor,
  kalshiPrice,
  sideChance,
  STAT_BY_KEY,
  type KalshiMarket,
} from "../lib/props";

type Results = { fields: string[]; results: Record<string, number[] | null> };

type Props = {
  legs: ParlayLeg[];
  boardDate: string;
  probFor: (leg: ParlayLeg) => number | null;
  marketsFor: (leg: ParlayLeg) => KalshiMarket[];
  onBet: (leg: ParlayLeg) => void;
};

const pct = (p: number | null) => (p === null ? "—" : `${Math.round(p * 100)}%`);

const ParlaySlip: React.FC<Props> = ({ legs, boardDate, probFor, marketsFor, onBet }) => {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Results | null>(null);

  const pastKeys = legs.filter((l) => autoGrades(l) && l.date < boardDate).map((l) => `${l.playerId}:${l.date}`);
  const keyString = [...new Set(pastKeys)].join(",");

  useEffect(() => {
    if (!keyString) return;
    let alive = true;
    getJson<Results>(`/props/results?keys=${encodeURIComponent(keyString)}`)
      .then((r) => alive && setResults(r))
      .catch(() => alive && setResults(null));
    return () => {
      alive = false;
    };
  }, [keyString]);

  if (!legs.length) return null;

  const outcome = (leg: ParlayLeg): "won" | "lost" | "push" | null => {
    if (!autoGrades(leg)) return null;
    const row = results?.results[`${leg.playerId}:${leg.date}`];
    if (!row || !results) return null;
    const value = STAT_BY_KEY[leg.stat].parts.reduce((s, part) => s + row[results.fields.indexOf(part)], 0);
    if (value === leg.line) return "push";
    return (value > leg.line) === (leg.side === "Over") ? "won" : "lost";
  };

  const chances = legs.map((l) => sideChance(probFor(l), l.side));
  const combined = chances.every((c) => c !== null) ? chances.reduce((a, c) => a * (c as number), 1) : null;
  const kalshiPrices = legs.map((l) => kalshiPrice(kalshiFor(marketsFor(l), l.line), l.side));
  const kalshiCombined = kalshiPrices.every((p) => p !== null) ? kalshiPrices.reduce((a, p) => a * (p as number), 1) : null;
  const games = new Set(legs.map((l) => `${l.date}:${[l.team, l.opp].sort().join("-")}`));
  const sameGame = games.size < legs.length;
  const graded = legs.map(outcome);
  const decided = graded.filter((g) => g !== null);
  const status =
    graded.includes("lost") ? "Lost" : decided.length === legs.length ? (graded.every((g) => g === "push") ? "Push" : "Won") : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-violet-500 bg-violet-950/90 px-4 py-2.5 text-sm font-bold text-violet-100 shadow-lg shadow-black/50 backdrop-blur hover:bg-violet-900"
      >
        Phantom parlay · {legs.length} leg{legs.length === 1 ? "" : "s"}
        <span className="rounded-full bg-violet-500/30 px-2 py-0.5 text-xs">{status ?? pct(combined)}</span>
      </button>

      {open && (
        <aside
          aria-label="Phantom parlay"
          className="fixed inset-x-2 bottom-16 z-40 max-h-[75vh] overflow-y-auto rounded-2xl border border-violet-700/70 bg-slate-950/95 p-4 shadow-2xl shadow-black/60 backdrop-blur sm:inset-x-auto sm:right-4 sm:w-[26rem]"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-widest text-violet-200">Phantom parlay</h2>
              <p className="text-xs text-slate-500">Track it without betting. Legs are graded after the game.</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close parlay" className="text-xl leading-none text-slate-400 hover:text-white">
              ×
            </button>
          </div>

          <ul className="space-y-2">
            {legs.map((leg, i) => {
              const result = graded[i];
              return (
                <li key={leg.id} className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-white">{leg.name}</p>
                      <p className="text-xs text-slate-500">
                        {leg.team} vs {leg.opp} · {leg.date}
                      </p>
                    </div>
                    <button type="button" onClick={() => parlay.remove(leg.id)} aria-label={`Remove ${leg.name}`} className="text-slate-500 hover:text-white">
                      ×
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold text-slate-200">{STAT_BY_KEY[leg.stat].label}</span>
                    <div className="inline-flex overflow-hidden rounded-md border border-slate-700 text-xs font-bold">
                      {(["Over", "Under"] as const).map((side) => (
                        <button
                          key={side}
                          type="button"
                          onClick={() => parlay.setSide(leg.id, side)}
                          className={`px-2 py-1 ${leg.side === side ? (side === "Over" ? "bg-emerald-600 text-white" : "bg-rose-600 text-white") : "text-slate-400 hover:text-white"}`}
                        >
                          {side === "Over" ? "O" : "U"}
                        </button>
                      ))}
                    </div>
                    <span className="tabular-nums text-slate-200">{leg.line}</span>
                    <span className="ml-auto tabular-nums text-slate-300">{pct(chances[i])}</span>
                    {result ? (
                      <span
                        className={`rounded px-1.5 py-0.5 text-[0.65rem] font-bold uppercase ${
                          result === "won" ? "bg-emerald-500/20 text-emerald-300" : result === "lost" ? "bg-rose-500/20 text-rose-300" : "bg-slate-700 text-slate-300"
                        }`}
                      >
                        {result}
                      </span>
                    ) : (
                      <button type="button" onClick={() => onBet(leg)} className="rounded-md border border-slate-600 px-2 py-0.5 text-xs font-semibold text-slate-200 hover:bg-slate-800">
                        Bet
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-4 space-y-1 border-t border-slate-800 pt-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">Our combined chance</span>
              <span className="font-bold tabular-nums text-white">
                {pct(combined)} {combined !== null && <span className="font-normal text-slate-500">(fair {fairOdds(combined)})</span>}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Kalshi, legs multiplied</span>
              <span className="tabular-nums text-slate-300">{kalshiCombined === null ? "not all legs listed" : pct(kalshiCombined)}</span>
            </div>
            {sameGame && (
              <p className="pt-1 text-xs text-amber-300">
                Some legs are from the same game. Their results are related, so the combined chance is only a rough guide.
              </p>
            )}
          </div>

          {!status && legs.length > 1 && (
            <div className="mt-4 space-y-2 border-t border-slate-800 pt-3">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Placed this parlay? Log it</h3>
              <LogBetForm
                key={legs.map((l) => l.id + l.side).join("|")}
                legs={legs.map((l) => ({
                  sport: l.sport,
                  playerId: l.playerId, name: l.name, team: l.team, opp: l.opp, stat: l.stat,
                  line: l.line, side: l.side, date: l.date, probOver: probFor(l),
                }))}
              />
            </div>
          )}

          <button type="button" onClick={() => parlay.clear()} className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-white">
            Clear parlay
          </button>
        </aside>
      )}
    </>
  );
};

export default ParlaySlip;
