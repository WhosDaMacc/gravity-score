import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import PlayerSearch from "../components/PlayerSearch";
import { ComponentLegend, COMPONENT_INFO, StackedBar } from "../components/GravityBars";
import { DataSourceNote, Spinner } from "../components/StatusViews";
import { useDocumentTitle, useLeaderboard, usePropsBoard, useSlateBoard } from "../lib/hooks";
import { currentSeason, fmt, uvsTone } from "../lib/format";
import {
  buildPicks,
  directionalHits,
  LEAN_EXPLAINER,
  pickText,
  playerLeans,
  TIER_ORDER,
  TIER_SPECS,
  type Parlay,
  type Pick,
  type TierKey,
} from "../lib/picks";
import type { PropsBoard } from "../lib/props";

const pct = (rate: number) => `${Math.round(rate * 100)}%`;

const Landing: React.FC = () => {
  useDocumentTitle("");
  const { data, loading, error } = useLeaderboard(currentSeason());
  const top = data?.players.slice(0, 5) ?? [];
  const maxGravity = top[0]?.gravity ?? 1;

  const nbaBoard = usePropsBoard("nba");
  const nflSlate = useSlateBoard("nfl");
  const leans = useMemo(() => {
    const tagged: { pick: Pick; sport: string }[] = [];
    if (nbaBoard.data && nbaBoard.data.games.length) {
      for (const pick of playerLeans(nbaBoard.data)) tagged.push({ pick, sport: "nba" });
    }
    if (nflSlate.board && nflSlate.board.games.length) {
      for (const pick of playerLeans(nflSlate.board)) tagged.push({ pick, sport: "nfl" });
    }
    return tagged.sort((a, b) => b.pick.estimate - a.pick.estimate).slice(0, 5);
  }, [nbaBoard.data, nflSlate.board]);
  const nflLeanDate =
    nflSlate.lookedAhead && nflSlate.board && leans.some((l) => l.sport === "nfl")
      ? new Date(`${nflSlate.board.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
      : null;

  // The #1 parlay per tier across the available boards (NBA tonight, plus the
  // NFL slate when it has games), chosen by combined estimate. Tiers with no
  // parlay on any board are skipped silently here — /picks explains why.
  const bestParlays = useMemo(() => {
    const boards: { board: PropsBoard; sport: string }[] = [];
    if (nbaBoard.data && nbaBoard.data.games.length) boards.push({ board: nbaBoard.data, sport: "nba" });
    if (nflSlate.board && nflSlate.board.games.length) boards.push({ board: nflSlate.board, sport: "nfl" });
    const results = boards.map(({ board, sport }) => ({ result: buildPicks(board), sport }));
    const chosen: { tier: TierKey; parlay: Parlay; sport: string }[] = [];
    for (const tier of TIER_ORDER) {
      const candidates = results
        .flatMap(({ result, sport }) => result.parlays[tier].slice(0, 1).map((parlay) => ({ tier, parlay, sport })))
        .sort((a, b) => b.parlay.combined - a.parlay.combined);
      if (candidates[0]) chosen.push(candidates[0]);
    }
    return chosen;
  }, [nbaBoard.data, nflSlate.board]);

  return (
    <div className="space-y-20">
      <section className="relative overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-950 to-emerald-950/40 px-6 py-16 sm:px-12">
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full border border-teal-400/10" />
        <div className="pointer-events-none absolute -right-10 -top-10 h-52 w-52 rounded-full border border-teal-400/20" />
        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.25em] text-emerald-400">
          NBA · {currentSeason()} season · Powered by the Gravity Score
        </p>
        <h1 className="max-w-3xl text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl">
          Who do you lean on tonight?
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-slate-400">
          Every night, Gravity Score measures the pull each player puts on a defense — then turns that
          pull into the night&apos;s best leans: suggested bets and premade parlays built from how often
          each player&apos;s recent games cleared tonight&apos;s lines. Suggestions from past hit rates,
          never promises.
        </p>
        <div className="mt-8 max-w-xl">
          <PlayerSearch size="lg" />
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            to="/picks"
            className="rounded-full bg-emerald-500 px-5 py-2.5 text-sm font-bold text-slate-950 transition-colors hover:bg-emerald-400"
          >
            Tonight&apos;s suggested bets
          </Link>
          <Link
            to="/leaderboard"
            className="rounded-full border border-slate-700 px-5 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800"
          >
            Gravity leaderboard
          </Link>
          <Link
            to="/how-it-works"
            className="rounded-full border border-slate-700 px-5 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800"
          >
            How it works
          </Link>
        </div>
      </section>

      {leans.length > 0 && (
        <section>
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-white">Top leans tonight</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">{LEAN_EXPLAINER}</p>
            {nflLeanDate && <p className="mt-1 text-xs text-amber-200">NFL leans are for the next slate, {nflLeanDate}.</p>}
          </div>
          <ol className="grid gap-3">
            {leans.map(({ pick, sport }) => {
              const l10 = pick.windows.L10;
              const hits = directionalHits(l10, pick.direction);
              return (
                <li key={`${sport}:${pick.key}`}>
                  <Link
                    to={sport === "nfl" ? "/picks?sport=nfl" : "/picks"}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-emerald-900/60 bg-slate-900/50 px-5 py-4 transition-colors hover:border-emerald-600 hover:bg-slate-900"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-white">
                        {pick.playerName}{" "}
                        <span className="text-sm font-normal text-slate-500">
                          {pick.team} {pick.home ? "vs" : "@"} {pick.opp}
                        </span>
                        {sport === "nfl" && (
                          <span className="ml-2 rounded bg-slate-700/60 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase text-slate-300">
                            NFL
                          </span>
                        )}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[0.65rem] font-black uppercase ${
                            pick.direction === "Over" ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"
                          }`}
                        >
                          {pick.direction} {pick.line} {pick.statLabel}
                        </span>
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[0.65rem] font-semibold text-slate-300">
                          L10 {hits}/{l10.n} {pick.direction === "Over" ? "overs" : "unders"}
                        </span>
                        {pick.lineSource === "book" ? (
                          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase text-emerald-300">
                            Book
                          </span>
                        ) : (
                          <span
                            className="rounded bg-slate-700/60 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase text-slate-300"
                            title="No sportsbook line; set at the player's season average"
                          >
                            Avg
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-black tabular-nums text-emerald-300">{pct(pick.estimate)}</p>
                      <p className="text-[0.65rem] uppercase tracking-wider text-slate-500">Lean</p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-xs text-slate-500">
            Suggestions from past hit rates — not a guarantee. See all of tonight&apos;s leans on{" "}
            <Link to="/picks" className="font-semibold text-emerald-300 hover:text-emerald-200">
              Suggested Bets
            </Link>
            .
          </p>
        </section>
      )}

      {bestParlays.length > 0 && (
        <section>
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-white">Tonight&apos;s best parlays</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              The top premade parlay in each tier. Pick one up as-is, or open Suggested Bets to remove legs and
              fade sides before you copy the slip.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {bestParlays.map(({ tier, parlay, sport }) => (
              <Link
                key={tier}
                to={sport === "nfl" ? "/picks?sport=nfl" : "/picks"}
                className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/40 p-4 transition-colors hover:border-slate-600 hover:bg-slate-900"
              >
                <h3 className="flex flex-wrap items-baseline gap-2">
                  <span
                    className={`text-lg font-black ${
                      tier === "safe" ? "text-emerald-300" : tier === "moderate" ? "text-amber-300" : "text-rose-300"
                    }`}
                  >
                    {TIER_SPECS[tier].label}
                  </span>
                  <span className="text-xs text-slate-500">
                    {parlay.legs.length} legs · {sport === "nfl" ? "NFL" : "NBA"}
                  </span>
                </h3>
                <ul className="mt-3 flex-1 space-y-1.5">
                  {parlay.legs.map((leg) => (
                    <li key={leg.key} className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate font-medium text-slate-200">{pickText(leg)}</span>
                      <span className="shrink-0 tabular-nums text-slate-400">{pct(leg.estimate)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 border-t border-slate-800 pt-3 text-sm text-slate-300">
                  Combined <span className="font-black tabular-nums text-white">~{pct(parlay.combined)}</span>
                  <span className="block text-xs text-slate-500">
                    Estimate — legs assumed independent; parlays are hard to hit. Suggestion only — no bet is
                    guaranteed.
                  </span>
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-white">Top gravity right now</h2>
            {data && <DataSourceNote meta={data} />}
          </div>
          <ComponentLegend />
        </div>
        {loading && !data && <Spinner label="Loading the leaderboard…" />}
        {error && <p className="text-sm text-slate-500">Live rankings are unavailable right now.</p>}
        <ol className="grid gap-3">
          {top.map((p) => (
            <li key={p.player_id}>
              <Link
                to={`/players/${p.slug}`}
                className="flex items-center gap-4 rounded-2xl border border-slate-800 bg-slate-900/50 px-5 py-4 transition-colors hover:border-slate-600 hover:bg-slate-900"
              >
                <span className="w-8 text-xl font-black text-slate-600">{p.rank}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-white">
                    {p.player_name} <span className="text-sm font-normal text-slate-500">{p.team}</span>
                  </p>
                  <div className="mt-2">
                    <StackedBar components={p.components} max={maxGravity} />
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-2xl font-black ${uvsTone(p.uvs)}`}>{fmt(p.uvs, 0)}</p>
                  <p className="text-[0.65rem] uppercase tracking-wider text-slate-500">Score</p>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {(Object.keys(COMPONENT_INFO) as (keyof typeof COMPONENT_INFO)[]).map((key) => (
          <div key={key} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <span className={`mb-4 block h-1.5 w-10 rounded-full ${COMPONENT_INFO[key].color}`} />
            <h3 className="text-lg font-bold text-white">{COMPONENT_INFO[key].label}</h3>
            <p className="mt-2 text-sm text-slate-400">{COMPONENT_INFO[key].blurb}</p>
          </div>
        ))}
      </section>
    </div>
  );
};

export default Landing;
