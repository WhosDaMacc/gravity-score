import React, { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ErrorState, Spinner } from "../components/StatusViews";
import { NFL_LOOKAHEAD_DAYS, useDocumentTitle, useSlateBoard } from "../lib/hooks";
import {
  combinedEstimate,
  directionalHits,
  directionalRate,
  flipPick,
  parlaySlip,
  pickText,
  buildPicks,
  TIER_ORDER,
  TIER_SPECS,
  type Parlay,
} from "../lib/picks";
import { SPORT_LABELS, type WindowKey } from "../lib/props";

const pct = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);

function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

const Picks: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const sport = params.get("sport") === "nfl" ? "nfl" : "nba";
  useDocumentTitle("Suggested bets");
  const { board, loading, error, retry, lookedAhead } = useSlateBoard(sport);
  const [fadedSingles, setFadedSingles] = useState<Set<string>>(new Set());

  const picks = useMemo(() => (board && board.games.length ? buildPicks(board) : null), [board]);

  if (loading && !board) return <Spinner label="Building today's suggestions…" />;
  if (error) return <ErrorState error={error} onRetry={retry} />;
  if (!board) return null;

  const sportLabel = SPORT_LABELS[sport] ?? "NBA";
  const toggleFadeSingle = (key: string) =>
    setFadedSingles((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white">Suggested bets</h1>
          <p className="text-sm text-slate-400">
            {sportLabel} · {formatDate(board.date)} · {board.games.length} game{board.games.length === 1 ? "" : "s"} · ranked by
            recent hit rates vs today&apos;s lines
          </p>
          {lookedAhead && board.games.length > 0 && (
            <p className="mt-1 text-sm text-amber-200">
              No {sportLabel} games today — this is the next slate, {formatDate(board.date)}.
            </p>
          )}
        </div>

        <div className="flex gap-1 self-start rounded-2xl border border-slate-800 bg-slate-900/60 p-1">
          {(["nba", "nfl"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setParams(new URLSearchParams({ sport: s }), { replace: true })}
              className={`rounded-xl px-3 py-1 text-xs font-bold transition-colors ${
                sport === s ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              {SPORT_LABELS[s]}
            </button>
          ))}
        </div>

        <div className="rounded-2xl border-2 border-amber-500/60 bg-amber-950/40 p-4" role="note">
          <p className="text-base font-bold text-amber-200">These are suggestions, not promises.</p>
          <p className="mt-1 text-sm leading-relaxed text-amber-100/90">
            Every pick below is based on past hit rates, and past performance does not guarantee future results. Use your own
            judgment — fade a pick or drop a leg whenever your gut or your research says so. That&apos;s why every bet here
            has a Fade button and every parlay leg can be removed.
          </p>
        </div>

        <p className="text-sm">
          <Link to="/history" className="font-semibold text-emerald-300 hover:text-emerald-200">
            Every pick gets graded — see our track record →
          </Link>
        </p>

        {picks && !picks.hasBookLines && (
          <p className="rounded-xl border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
            Sportsbook lines aren&apos;t loaded for this slate yet — every line below is set at the player&apos;s season
            average, not a live book line. Hit rates are still real; re-check the line at your book before betting.
          </p>
        )}
      </header>

      {board.games.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 p-8 text-center text-slate-400">
          {sport === "nfl"
            ? `No NFL games today or in the next ${NFL_LOOKAHEAD_DAYS} days, so there are no suggestions to make. Check back on game day.`
            : `No ${sportLabel} games today, so there are no suggestions to make. Check back on game day.`}
        </p>
      ) : !picks || (picks.singles.length === 0 && TIER_ORDER.every((t) => picks.parlays[t].length === 0)) ? (
        <section className="rounded-2xl border border-slate-800 p-8 text-center">
          <p className="font-semibold text-slate-200">No suggestions cleared the bar for this slate.</p>
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-400">
            A suggestion needs a player with 5+ season games, 5+ games in the last-10 sample, and a directional hit-rate
            estimate of at least 58% for singles (70% / 60% / 52% per parlay tier). Rather than lower the bar and pad the
            page with weak picks, we&apos;d rather show nothing.
          </p>
          {picks && TIER_ORDER.map((t) => picks.shortfalls[t] && (
            <p key={t} className="mx-auto mt-2 max-w-xl text-xs text-slate-500">
              {TIER_SPECS[t].label}: {picks.shortfalls[t]}
            </p>
          ))}
        </section>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-widest text-emerald-300">Today&apos;s suggested bets</h2>
            <div className="overflow-x-auto rounded-2xl border border-slate-800">
              <table className="w-full text-sm">
                <thead className="bg-slate-900/80 text-xs text-slate-400">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left uppercase tracking-wider">Player · suggestion</th>
                    <th scope="col" className="px-2 py-2 text-center uppercase tracking-wider">Line</th>
                    {(["L5", "L10", "SZN"] as WindowKey[]).map((w) => (
                      <th key={w} scope="col" className={`px-2 py-2 text-center uppercase tracking-wider ${w === "SZN" ? "hidden sm:table-cell" : ""}`}>{w}</th>
                    ))}
                    <th scope="col" className="px-2 py-2 text-right uppercase tracking-wider">Hit est.</th>
                    <th scope="col" className="px-2 py-2 text-right uppercase tracking-wider">Your call</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {picks.singles.map((original) => {
                    const faded = fadedSingles.has(original.key);
                    const pick = faded ? flipPick(original) : original;
                    return (
                      <tr key={original.key} className="hover:bg-slate-900/50">
                        <td className="px-3 py-2">
                          <div className="font-semibold text-white">{pick.playerName}</div>
                          <div className="text-xs text-slate-500">
                            {pick.team} {pick.home ? "vs" : "@"} {pick.opp} · {pick.statName}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                            <span className={`rounded px-1.5 py-0.5 text-[0.65rem] font-black uppercase ${pick.direction === "Over" ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>
                              {pick.direction} {pick.line}
                            </span>
                            {faded && <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase text-sky-300">Faded by you</span>}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-center">
                          {pick.lineSource === "book" ? (
                            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase text-emerald-300" title={pick.books ? `${pick.books} books` : undefined}>
                              Book
                            </span>
                          ) : (
                            <span className="rounded bg-slate-700/60 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase text-slate-300" title="No sportsbook line; set at the player's season average">
                              Avg
                            </span>
                          )}
                        </td>
                        {(["L5", "L10", "SZN"] as WindowKey[]).map((w) => {
                          const hr = pick.windows[w];
                          return (
                            <td key={w} className={`px-2 py-2 text-center tabular-nums text-slate-300 ${w === "SZN" ? "hidden sm:table-cell" : ""}`}>
                              {pct(directionalRate(hr, pick.direction))}
                              <span className="block text-[0.65rem] text-slate-500">{directionalHits(hr, pick.direction)}/{hr.n}</span>
                            </td>
                          );
                        })}
                        <td className="px-2 py-2 text-right">
                          <span className="text-lg font-black tabular-nums text-white">{pct(pick.estimate)}</span>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => toggleFadeSingle(original.key)}
                            aria-pressed={faded}
                            className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                              faded ? "border-sky-400 bg-sky-500/15 text-sky-200" : "border-slate-600 text-slate-300 hover:bg-slate-800"
                            }`}
                            title={faded ? "Back to the suggested side" : "Take the other side and see its hit rate"}
                          >
                            {faded ? "Unfade" : "Fade"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500">
              Suggestions from past hit rates only — not a guarantee. Disagree with one? Fade it and take the other side.
            </p>
          </section>

          <section className="space-y-6">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-widest text-emerald-300">Premade parlays</h2>
              <p className="mt-1 text-sm text-slate-400">
                Pick one up as-is, or make it yours: remove legs, fade a side, then copy the slip. Safer = higher hit
                rates. No bet is guaranteed.
              </p>
            </div>
            {TIER_ORDER.map((tier) => (
              <div key={tier} className="space-y-3">
                <h3 className="flex flex-wrap items-baseline gap-2">
                  <span className={`text-lg font-black ${tier === "safe" ? "text-emerald-300" : tier === "moderate" ? "text-amber-300" : "text-rose-300"}`}>
                    {TIER_SPECS[tier].label}
                  </span>
                  <span className="text-xs text-slate-500">{TIER_SPECS[tier].note}</span>
                </h3>
                {picks.parlays[tier].length === 0 ? (
                  <p className="rounded-2xl border border-slate-800 p-4 text-sm text-slate-400">{picks.shortfalls[tier]}</p>
                ) : (
                  <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                    {picks.parlays[tier].map((parlay) => (
                      <ParlayCard
                        key={parlay.id}
                        parlay={parlay}
                        sportLabel={sportLabel}
                        dateLabel={formatDate(board.date)}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </section>

          <Methodology />
        </>
      )}

      <footer className="border-t border-slate-800 pt-4 text-center text-xs leading-relaxed text-slate-500">
        <p className="font-semibold text-slate-400">21+. Bet responsibly. If gambling stops being fun, call 1-800-GAMBLER.</p>
        <p className="mt-1">Suggestions only — Gravity Score does not take bets and cannot promise any outcome.</p>
      </footer>
    </div>
  );
};

const ParlayCard: React.FC<{ parlay: Parlay; sportLabel: string; dateLabel: string }> = ({ parlay, sportLabel, dateLabel }) => {
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [faded, setFaded] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  const legs = parlay.legs
    .filter((leg) => !removed.has(leg.key))
    .map((leg) => (faded.has(leg.key) ? flipPick(leg) : leg));
  const edited = removed.size > 0 || faded.size > 0;
  const combined = legs.length ? combinedEstimate(legs) : null;
  const spec = TIER_SPECS[parlay.tier];

  const toggleIn = (set: Set<string>, key: string, apply: React.Dispatch<React.SetStateAction<Set<string>>>) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    apply(next);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(parlaySlip(parlay, sportLabel, dateLabel, legs));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <article className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h4 className="font-black text-white">
            {spec.label} · {parlay.legs.length} legs
          </h4>
          <p className="text-xs text-slate-500">{dateLabel}</p>
        </div>
        {edited && <span className="rounded bg-sky-500/15 px-2 py-0.5 text-[0.65rem] font-bold uppercase text-sky-300">Edited by you</span>}
      </header>

      <ul className="mt-3 flex-1 space-y-2">
        {parlay.legs.map((original) => {
          const isRemoved = removed.has(original.key);
          const isFaded = faded.has(original.key);
          const leg = isFaded ? flipPick(original) : original;
          return (
            <li
              key={original.key}
              className={`rounded-xl border border-slate-800 px-3 py-2 ${isRemoved ? "opacity-40" : "bg-slate-950/50"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className={isRemoved ? "line-through" : ""}>
                  <span className="font-semibold text-white">{pickText(leg)}</span>
                  <span className="block text-xs text-slate-500">
                    {leg.team} {leg.home ? "vs" : "@"} {leg.opp} · hit est. {pct(leg.estimate)}
                    {leg.lineSource === "avg" && " · avg line"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => toggleIn(removed, original.key, setRemoved)}
                  aria-label={isRemoved ? `Restore ${original.playerName}` : `Remove ${original.playerName} from this parlay`}
                  className="rounded-full border border-slate-700 px-2 py-0.5 text-xs font-bold text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  {isRemoved ? "↩" : "✕"}
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {original.swing && (
                  <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase text-rose-300">Swing leg</span>
                )}
                {isFaded && <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase text-sky-300">Faded by you</span>}
                {!isRemoved && (
                  <button
                    type="button"
                    onClick={() => toggleIn(faded, original.key, setFaded)}
                    aria-pressed={isFaded}
                    className={`rounded-full border px-2 py-0.5 text-[0.65rem] font-bold transition-colors ${
                      isFaded ? "border-sky-400 bg-sky-500/15 text-sky-200" : "border-slate-700 text-slate-400 hover:text-white"
                    }`}
                  >
                    {isFaded ? "Unfade" : `Fade → ${leg.direction === "Over" ? "Under" : "Over"}`}
                  </button>
                )}
                {isRemoved && <span className="text-[0.65rem] font-semibold uppercase text-slate-500">Removed by you</span>}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 border-t border-slate-800 pt-3">
        {legs.length === 0 ? (
          <p className="text-sm text-slate-400">You removed every leg. Reset below to restore the premade parlay.</p>
        ) : (
          <p className="text-sm text-slate-300">
            Combined <span className="font-black tabular-nums text-white">~{pct(combined)}</span>
            <span className="block text-xs text-slate-500">
              Estimate — legs assumed independent; parlays are hard to hit.
              {legs.length === 1 && " (One leg left: this is now a single.)"}
            </span>
          </p>
        )}
        <p className="mt-2 text-xs text-slate-500">
          {parlay.tier === "safe" ? "Safer = higher hit rates. " : ""}Suggestion only — no bet is guaranteed.
        </p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={copy}
            disabled={legs.length === 0}
            className="flex-1 rounded-xl bg-emerald-500/90 px-3 py-2 text-sm font-bold text-emerald-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {copied ? "Copied ✓" : "Copy parlay"}
          </button>
          {edited && (
            <button
              type="button"
              onClick={() => {
                setRemoved(new Set());
                setFaded(new Set());
              }}
              className="rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-slate-300 hover:bg-slate-800"
            >
              Reset
            </button>
          )}
        </div>
      </div>
    </article>
  );
};

const Methodology: React.FC = () => (
  <details className="rounded-2xl border border-slate-800 bg-slate-900/30 p-4 text-sm text-slate-400">
    <summary className="cursor-pointer font-semibold text-slate-200">How these suggestions are built</summary>
    <div className="mt-3 space-y-2">
      <p>
        <span className="font-semibold text-slate-200">Hit-rate estimate.</span> For each player prop we blend how often the
        player went over the line in their last 5, 10 and 20 games, this season, and head-to-head vs tonight&apos;s opponent
        (the same Clear % as the Props heat map), shrunk toward 50% when the recent sample is small. An Under suggestion
        uses the other side of the same number (1 − Clear %). A prop only becomes a suggestion with 5+ season games, 5+
        games in the last-10 sample, and at least 3 season games where the player actually recorded the stat — no
        &ldquo;Under 0.5 threes&rdquo; for players who never shoot them.
      </p>
      <p>
        <span className="font-semibold text-slate-200">Tiers.</span> Safe: 2 legs at 70%+, never two from the same game.
        Moderate: 3 legs at 60%+. Risky: 4–5 legs at 52%+, and it may include one higher-variance swing leg (passing TDs,
        points+rebounds+assists). No parlay ever uses the same player twice, and if a tier can&apos;t be filled at its bar
        we show fewer parlays — or none — instead of padding with weaker legs.
      </p>
      <p>
        <span className="font-semibold text-slate-200">Combined estimate.</span> Leg estimates multiplied together, which
        assumes the legs are independent. They aren&apos;t perfectly — same-game legs rise and fall together — so treat the
        combined number as a rough guide, not a probability. Parlays are hard to hit by design.
      </p>
      <p>
        <span className="font-semibold text-slate-200">Lines.</span> When sportsbooks have posted lines for the slate,
        suggestions use only those book lines. When they haven&apos;t, lines are set at each player&apos;s season average
        and the page says so at the top — check the live line at your book, because your number may differ.
      </p>
      <p>Hit rates describe the past, not a guarantee. Minutes, injuries and matchups change. Use your own judgment.</p>
    </div>
  </details>
);

export default Picks;
