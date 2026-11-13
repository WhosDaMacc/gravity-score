import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import LogBetForm from "../components/LogBetForm";
import { useDocumentTitle, usePropsBoard } from "../lib/hooks";
import { STAT_BY_KEY, STATS, type Side, type StatKey } from "../lib/props";
import {
  americanToDecimal,
  autoGrades,
  fetchResults,
  formatOdds,
  legLabel,
  legOutcome,
  money,
  settle,
  toCsv,
  todayEastern,
  tracker,
  useBets,
  type BetResult,
  type GameResults,
  type LegOutcome,
  type Settlement,
  type TrackedBet,
  type TrackedLeg,
} from "../lib/tracker";

const RESULT_STYLES: Record<string, string> = {
  won: "bg-emerald-500/20 text-emerald-300",
  lost: "bg-rose-500/20 text-rose-300",
  push: "bg-slate-700 text-slate-300",
  void: "bg-slate-700 text-slate-300",
  pending: "bg-sky-500/15 text-sky-300",
  review: "bg-amber-500/20 text-amber-300",
};

const Badge: React.FC<{ result: string }> = ({ result }) => (
  <span className={`rounded px-1.5 py-0.5 text-[0.65rem] font-bold uppercase ${RESULT_STYLES[result] ?? ""}`}>
    {result === "review" ? "settle manually" : result}
  </span>
);

type Row = { bet: TrackedBet; outcomes: LegOutcome[]; s: Settlement };

function summarize(rows: Row[]) {
  const settled = rows.filter((r) => ["won", "lost", "push", "void"].includes(r.s.result));
  const won = settled.filter((r) => r.s.result === "won").length;
  const lost = settled.filter((r) => r.s.result === "lost").length;
  const pushes = settled.length - won - lost;
  const staked = settled.filter((r) => r.s.result === "won" || r.s.result === "lost").reduce((a, r) => a + r.bet.stake, 0);
  const profit = settled.reduce((a, r) => a + r.s.profit, 0);
  return { count: rows.length, won, lost, pushes, staked, profit, roi: staked ? profit / staked : null };
}

const ProfitChart: React.FC<{ rows: Row[] }> = ({ rows }) => {
  const points = useMemo(() => {
    const settled = rows
      .filter((r) => r.s.result === "won" || r.s.result === "lost")
      .sort((a, b) => (a.bet.legs.at(-1)?.date ?? "").localeCompare(b.bet.legs.at(-1)?.date ?? "") || a.bet.placedAt.localeCompare(b.bet.placedAt));
    let total = 0;
    return [0, ...settled.map((r) => (total += r.s.profit))];
  }, [rows]);
  if (points.length < 3) return <p className="py-8 text-center text-sm text-slate-500">The chart appears after a couple of settled bets.</p>;

  const w = 600, h = 160, pad = 8;
  const min = Math.min(0, ...points), max = Math.max(0, ...points);
  const x = (i: number) => pad + (i / (points.length - 1)) * (w - 2 * pad);
  const y = (v: number) => h - pad - ((v - min) / (max - min || 1)) * (h - 2 * pad);
  const last = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-40 w-full" role="img" aria-label={`Cumulative profit, now ${money(last)}`}>
      <line x1={pad} x2={w - pad} y1={y(0)} y2={y(0)} stroke="#334155" strokeDasharray="4 4" />
      <polyline
        fill="none"
        stroke={last >= 0 ? "#34d399" : "#fb7185"}
        strokeWidth="2.5"
        strokeLinejoin="round"
        points={points.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
      />
    </svg>
  );
};

const Breakdown: React.FC<{ title: string; groups: [string, Row[]][] }> = ({ title, groups }) => (
  <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
    <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-400">{title}</h3>
    {groups.length === 0 ? (
      <p className="text-sm text-slate-500">No settled bets yet.</p>
    ) : (
      <table className="w-full text-sm">
        <tbody className="divide-y divide-slate-800/70">
          {groups.map(([name, rows]) => {
            const s = summarize(rows);
            return (
              <tr key={name}>
                <td className="py-1.5 text-slate-200">{name}</td>
                <td className="py-1.5 text-right tabular-nums text-slate-400">{s.won}-{s.lost}{s.pushes ? `-${s.pushes}` : ""}</td>
                <td className={`py-1.5 text-right font-semibold tabular-nums ${s.profit >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{money(s.profit)}</td>
                <td className="py-1.5 text-right tabular-nums text-slate-400">{s.roi === null ? "—" : `${Math.round(s.roi * 100)}%`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    )}
  </section>
);

const ManualEntry: React.FC = () => {
  const { data: board } = usePropsBoard("nba");
  const blank = { name: "", stat: "pts" as StatKey, line: "", side: "Over" as Side, date: todayEastern() };
  const [draft, setDraft] = useState(blank);
  const [legs, setLegs] = useState<TrackedLeg[]>([]);
  const [error, setError] = useState<string | null>(null);

  const addLeg = () => {
    const line = Number(draft.line);
    if (!draft.name.trim() || !Number.isFinite(line) || draft.line === "") return setError("Enter a player and a line.");
    const match = board?.players.find((p) => p.name.toLowerCase() === draft.name.trim().toLowerCase());
    setLegs([...legs, {
      playerId: match?.id, name: match?.name ?? draft.name.trim(), team: match?.team, opp: match?.opp,
      stat: draft.stat, line, side: draft.side, date: draft.date,
    }]);
    setDraft({ ...blank, date: draft.date });
    setError(null);
  };

  const field = "rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white outline-none focus:border-emerald-500";
  return (
    <details className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
      <summary className="cursor-pointer text-sm font-semibold text-slate-200">Add a bet manually</summary>
      <div className="mt-3 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <input list="tracker-players" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Player" aria-label="Player" className={`${field} w-44`} />
          <datalist id="tracker-players">
            {board?.players.map((p) => <option key={p.id} value={p.name} />)}
          </datalist>
          <select value={draft.stat} onChange={(e) => setDraft({ ...draft, stat: e.target.value as StatKey })} aria-label="Stat" className={field}>
            {STATS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <select value={draft.side} onChange={(e) => setDraft({ ...draft, side: e.target.value as Side })} aria-label="Side" className={field}>
            <option>Over</option>
            <option>Under</option>
          </select>
          <input value={draft.line} onChange={(e) => setDraft({ ...draft, line: e.target.value })} placeholder="Line" inputMode="decimal" aria-label="Line" className={`${field} w-20`} />
          <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} aria-label="Game date" className={field} />
          <button type="button" onClick={addLeg} className="rounded-md border border-slate-600 px-3 py-1.5 text-sm font-semibold text-slate-200 hover:bg-slate-800">
            + Add leg
          </button>
        </div>
        {error && <p className="text-xs text-rose-300">{error}</p>}
        <p className="text-xs text-slate-500">
          Pick tonight&apos;s players from the suggestions so the bet can be graded automatically; anyone else can be settled by hand.
        </p>
        {legs.length > 0 && (
          <div className="space-y-3">
            <ul className="space-y-1 text-sm">
              {legs.map((l, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="text-slate-200">{legLabel(l)}</span>
                  <span className="text-xs text-slate-500">{l.date}{autoGrades(l) ? "" : " · manual grading"}</span>
                  <button type="button" onClick={() => setLegs(legs.filter((_, j) => j !== i))} className="text-slate-500 hover:text-white" aria-label="Remove leg">×</button>
                </li>
              ))}
            </ul>
            <LogBetForm key={legs.length} legs={legs} />
          </div>
        )}
      </div>
    </details>
  );
};

const Tracker: React.FC = () => {
  useDocumentTitle("My bets");
  const bets = useBets();
  const [results, setResults] = useState<GameResults | null>(null);
  const [filter, setFilter] = useState<"all" | "pending" | "settled">("all");
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const today = todayEastern();

  const gradeKey = bets.flatMap((b) => b.legs).filter((l) => autoGrades(l) && l.date < today).map((l) => `${l.playerId}:${l.date}`).sort().join(",");
  useEffect(() => {
    if (!gradeKey) return;
    let alive = true;
    fetchResults(bets, today).then((r) => alive && setResults(r)).catch(() => alive && setResults(null));
    return () => {
      alive = false;
    };
    // Refetch only when the set of gradeable legs changes.
  }, [gradeKey]);

  const rows: Row[] = useMemo(
    () => bets.map((bet) => {
      const outcomes = bet.legs.map((l) => legOutcome(l, results));
      return { bet, outcomes, s: settle(bet, outcomes) };
    }),
    [bets, results],
  );

  const total = summarize(rows);
  const pending = rows.filter((r) => r.s.result === "pending" || r.s.result === "review");
  const settledRows = rows.filter((r) => !pending.includes(r));
  const shown = filter === "pending" ? pending : filter === "settled" ? settledRows : rows;

  const group = (key: (r: Row) => string | null) => {
    const map = new Map<string, Row[]>();
    for (const r of settledRows) {
      const k = key(r);
      if (k) map.set(k, [...(map.get(k) ?? []), r]);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  };

  const modelBuckets = useMemo(() => {
    const singles = settledRows.filter((r) => r.bet.legs.length === 1 && r.bet.legs[0].probOver != null && (r.s.result === "won" || r.s.result === "lost"));
    const chance = (r: Row) => {
      const leg = r.bet.legs[0];
      return leg.side === "Over" ? leg.probOver! : 1 - leg.probOver!;
    };
    return [
      ["Model under 50%", (c: number) => c < 0.5],
      ["Model 50–60%", (c: number) => c >= 0.5 && c < 0.6],
      ["Model 60%+", (c: number) => c >= 0.6],
    ].map(([label, test]) => {
      const inBucket = singles.filter((r) => (test as (c: number) => boolean)(chance(r)));
      const won = inBucket.filter((r) => r.s.result === "won").length;
      return { label: label as string, n: inBucket.length, rate: inBucket.length ? won / inBucket.length : null, profit: inBucket.reduce((a, r) => a + r.s.profit, 0) };
    });
  }, [settledRows]);

  const download = (name: string, content: string, type: string) => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importFile = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      const added = tracker.importBets(Array.isArray(parsed) ? parsed : parsed.bets ?? []);
      setNotice(`Imported ${added} bet${added === 1 ? "" : "s"}.`);
    } catch {
      setNotice("That file isn't a Gravity Score tracker export.");
    }
  };

  const settlements = new Map(rows.map((r) => [r.bet.id, r.s]));
  const card = "rounded-2xl border border-slate-800 bg-slate-900/50 p-4";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white">My bets</h1>
          <p className="text-sm text-slate-400">
            Your own bet tracker (the site&apos;s picks are on <Link to="/history" className="underline hover:text-white">Track Record</Link>).
            NBA props grade themselves the day after the game; settle others by hand. Saved in this browser; export to back up or move devices.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <button type="button" disabled={!bets.length} onClick={() => download(`gravity-score-bets-${today}.json`, JSON.stringify({ bets }, null, 1), "application/json")} className="rounded-full border border-slate-700 px-3 py-1.5 text-slate-300 hover:bg-slate-800 disabled:opacity-40">
            Export backup
          </button>
          <button type="button" disabled={!bets.length} onClick={() => download(`gravity-score-bets-${today}.csv`, toCsv(bets, settlements), "text/csv")} className="rounded-full border border-slate-700 px-3 py-1.5 text-slate-300 hover:bg-slate-800 disabled:opacity-40">
            Export CSV
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} className="rounded-full border border-slate-700 px-3 py-1.5 text-slate-300 hover:bg-slate-800">
            Import backup
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
        </div>
      </header>
      {notice && <p className="text-sm text-sky-300">{notice}</p>}

      {bets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700 p-10 text-center">
          <p className="text-lg font-semibold text-white">No bets tracked yet</p>
          <p className="mt-2 text-sm text-slate-400">
            On the <Link to="/props" className="text-emerald-300 underline">props page</Link>, hit <strong>Bet</strong> on any prop and
            use &ldquo;Log it&rdquo;, or log a whole phantom parlay. You can also add a bet manually below.
          </p>
        </div>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className={card}>
              <p className="text-[0.65rem] uppercase tracking-widest text-slate-500">Record</p>
              <p className="mt-1 text-2xl font-black tabular-nums text-white">{total.won}-{total.lost}{total.pushes ? `-${total.pushes}` : ""}</p>
              <p className="text-xs text-slate-500">{pending.length} open</p>
            </div>
            <div className={card}>
              <p className="text-[0.65rem] uppercase tracking-widest text-slate-500">Profit</p>
              <p className={`mt-1 text-2xl font-black tabular-nums ${total.profit >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{money(total.profit)}</p>
              <p className="text-xs text-slate-500">on {money(total.staked)} settled</p>
            </div>
            <div className={card}>
              <p className="text-[0.65rem] uppercase tracking-widest text-slate-500">ROI</p>
              <p className="mt-1 text-2xl font-black tabular-nums text-white">{total.roi === null ? "—" : `${(total.roi * 100).toFixed(1)}%`}</p>
              <p className="text-xs text-slate-500">profit ÷ amount staked</p>
            </div>
            <div className={card}>
              <p className="text-[0.65rem] uppercase tracking-widest text-slate-500">Win rate</p>
              <p className="mt-1 text-2xl font-black tabular-nums text-white">{total.won + total.lost ? `${Math.round((100 * total.won) / (total.won + total.lost))}%` : "—"}</p>
              <p className="text-xs text-slate-500">pending: {money(pending.reduce((a, r) => a + r.bet.stake, 0))} at risk</p>
            </div>
          </section>

          <section className={card}>
            <h2 className="mb-1 text-xs font-bold uppercase tracking-widest text-slate-400">Profit over time</h2>
            <ProfitChart rows={rows} />
          </section>

          <div className="grid gap-4 md:grid-cols-3">
            <Breakdown title="By book" groups={group((r) => r.bet.book)} />
            <Breakdown title="By stat (singles)" groups={group((r) => (r.bet.legs.length === 1 ? STAT_BY_KEY[r.bet.legs[0].stat].name : null))} />
            <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-400">Did the model help?</h3>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-800/70">
                  {modelBuckets.map((b) => (
                    <tr key={b.label}>
                      <td className="py-1.5 text-slate-200">{b.label}</td>
                      <td className="py-1.5 text-right tabular-nums text-slate-400">{b.n} bets</td>
                      <td className="py-1.5 text-right tabular-nums text-slate-200">{b.rate === null ? "—" : `${Math.round(b.rate * 100)}% won`}</td>
                      <td className={`py-1.5 text-right tabular-nums ${b.profit >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{b.n ? money(b.profit) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[0.7rem] text-slate-500">Settled single props logged from the site, grouped by our chance for the side you bet.</p>
            </section>
          </div>
        </>
      )}

      <ManualEntry />

      {bets.length > 0 && (
        <section className="space-y-3">
          <div className="flex gap-1">
            {(["all", "pending", "settled"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-full px-3 py-1 text-xs font-bold capitalize ${filter === f ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"}`}
              >
                {f === "pending" ? `Open (${pending.length})` : f}
              </button>
            ))}
          </div>
          <ul className="space-y-2">
            {shown.map(({ bet, outcomes, s }) => (
              <li key={bet.id} className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-slate-500">
                      {bet.legs.length > 1 ? `${bet.legs.length}-leg parlay` : "Single"} · {bet.book} · logged{" "}
                      {new Date(bet.placedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {bet.legs.map((leg, i) => (
                        <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="font-semibold text-white">{legLabel(leg)}</span>
                          <span className="text-xs text-slate-500">{leg.opp ? `vs ${leg.opp} · ` : ""}{leg.date}</span>
                          {outcomes[i] && <Badge result={outcomes[i]!} />}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="text-right">
                    <Badge result={s.result} />
                    <p className={`mt-1 text-lg font-black tabular-nums ${s.profit > 0 ? "text-emerald-300" : s.profit < 0 ? "text-rose-300" : "text-slate-300"}`}>
                      {s.result === "pending" || s.result === "review" ? `to win ${money(bet.stake * (americanToDecimal(bet.odds) - 1))}` : money(s.profit)}
                    </p>
                    <p className="text-xs tabular-nums text-slate-500">
                      {money(bet.stake)} at {formatOdds(bet.odds)}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-800 pt-2 text-xs">
                  <label className="flex items-center gap-1.5 text-slate-400">
                    Result
                    <select
                      value={bet.manualResult ?? ""}
                      onChange={(e) => tracker.update(bet.id, { manualResult: (e.target.value || null) as BetResult | null })}
                      className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-slate-200"
                    >
                      <option value="">Auto</option>
                      <option value="won">Won</option>
                      <option value="lost">Lost</option>
                      <option value="push">Push</option>
                      <option value="void">Void</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => window.confirm("Delete this bet from your tracker?") && tracker.remove(bet.id)}
                    className="ml-auto text-slate-500 hover:text-rose-300"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-[0.7rem] text-slate-500">For tracking and analysis only. Gambling problem? Call 1-800-GAMBLER.</p>
    </div>
  );
};

export default Tracker;
