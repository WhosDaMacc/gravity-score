import React, { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ComponentLegend, StackedBar } from "../components/GravityBars";
import { DataSourceNote, ErrorState, Spinner } from "../components/StatusViews";
import type { PlayerRow } from "../lib/api";
import { currentSeason, fmt, recentSeasons, slugify, uvsTone } from "../lib/format";
import { useDocumentTitle, useLeaderboard, usePropsBoard } from "../lib/hooks";
import { LEAN_EXPLAINER, playerLeans, playerNameKey, type Pick } from "../lib/picks";

type SortKey = "gravity" | "games" | "minutes" | "three_pa" | "drives" | "assists" | "turnovers";

const COLUMNS: { key: SortKey; label: string; title: string; className?: string }[] = [
  { key: "games", label: "GP", title: "Games played", className: "hidden md:table-cell" },
  { key: "minutes", label: "MIN", title: "Minutes per game", className: "hidden md:table-cell" },
  { key: "three_pa", label: "3PA", title: "3-point attempts per game", className: "hidden sm:table-cell" },
  { key: "drives", label: "DRV", title: "Drives per game", className: "hidden sm:table-cell" },
  { key: "assists", label: "AST", title: "Assists per game", className: "hidden sm:table-cell" },
  { key: "turnovers", label: "TOV", title: "Turnovers per game", className: "hidden lg:table-cell" },
];

const MIN_MINUTES_OPTIONS = [0, 10, 20, 30];

const Leaderboard: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const season = params.get("season") ?? currentSeason();
  const leanSort = params.get("sort") === "lean";
  const sort = (leanSort ? "gravity" : (params.get("sort") as SortKey | null) ?? "gravity") as SortKey;
  const asc = params.get("dir") === "asc";
  const filter = params.get("q") ?? "";
  const minMinutes = Number(params.get("min") ?? 0);

  useDocumentTitle(`NBA Gravity Leaderboard ${season}`);
  const { data, loading, error, retry } = useLeaderboard(season);
  const propsBoard = usePropsBoard("nba");

  // Tonight's leans, joined onto leaderboard rows by player name: the board
  // carries names, the leaderboard carries slugs. Exact slugified-name
  // matches win; where the two sources disagree on a generational suffix
  // (playerNameKey), the suffix-stripped match is used only when it is
  // unique on both sides. Leans only exist for the current season —
  // tonight's board says nothing about a past season's ranking. Players
  // with a lean but no leaderboard row (the leaderboard only lists
  // qualified players) simply never join, and rows without a game tonight
  // show "—".
  const leanBySlug = useMemo(() => {
    const map = new Map<string, Pick>();
    if (season !== currentSeason() || !propsBoard.data?.games.length || !data) return map;
    const leans = playerLeans(propsBoard.data);
    const exact = new Map(leans.map((p) => [slugify(p.playerName), p]));
    const leansByKey = new Map<string, Pick[]>();
    for (const p of leans) {
      const k = playerNameKey(p.playerName);
      leansByKey.set(k, [...(leansByKey.get(k) ?? []), p]);
    }
    const rowKeyCounts = new Map<string, number>();
    for (const row of data.players) {
      const k = playerNameKey(row.slug);
      rowKeyCounts.set(k, (rowKeyCounts.get(k) ?? 0) + 1);
    }
    for (const row of data.players) {
      const direct = exact.get(row.slug);
      if (direct) {
        map.set(row.slug, direct);
        continue;
      }
      const k = playerNameKey(row.slug);
      const candidates = leansByKey.get(k) ?? [];
      if (candidates.length === 1 && rowKeyCounts.get(k) === 1) map.set(row.slug, candidates[0]);
    }
    return map;
  }, [propsBoard.data, season, data]);
  const leansAvailable = leanBySlug.size > 0;

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  const setSort = (key: SortKey) => {
    if (!leanSort && key === sort) update({ dir: asc ? null : "asc" });
    else update({ sort: key === "gravity" ? null : key, dir: null });
  };

  const rows = useMemo(() => {
    if (!data) return [];
    const q = slugify(filter);
    const team = filter.trim().toUpperCase();
    const isTeam = data.players.some((p) => p.team === team);
    const filtered = data.players.filter(
      (p) => p.minutes >= minMinutes && (isTeam ? p.team === team : !q || p.slug.includes(q)),
    );
    if (leanSort) {
      // Players with a lean tonight first, strongest lean first (Gravity
      // breaks ties); everyone else sinks to the bottom in Gravity order.
      return [...filtered].sort((a: PlayerRow, b: PlayerRow) => {
        const la = leanBySlug.get(a.slug);
        const lb = leanBySlug.get(b.slug);
        if (la && lb) return lb.estimate - la.estimate || a.rank - b.rank;
        if (la) return -1;
        if (lb) return 1;
        return a.rank - b.rank;
      });
    }
    const dir = asc ? 1 : -1;
    return [...filtered].sort((a: PlayerRow, b: PlayerRow) => dir * (a[sort] - b[sort]) || a.rank - b.rank);
  }, [data, filter, minMinutes, sort, asc, leanSort, leanBySlug]);

  const maxGravity = data?.players[0]?.gravity ?? 1;

  const sortHeader = (k: SortKey, label: string, title: string, className = "") => {
    const active = !leanSort && sort === k;
    return (
      <th key={k} scope="col" className={`px-3 py-3 text-right ${className}`} aria-sort={active ? (asc ? "ascending" : "descending") : "none"}>
        <button type="button" title={title} onClick={() => setSort(k)} className={`whitespace-nowrap uppercase tracking-wider hover:text-white ${active ? "text-emerald-300" : ""}`}>
          {label}
          {active && <span aria-hidden="true">{asc ? " ▲" : " ▼"}</span>}
        </button>
      </th>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white">Gravity Leaderboard</h1>
          {data ? <DataSourceNote meta={data} /> : <p className="text-xs text-slate-500">{season} regular season</p>}
        </div>
        <ComponentLegend />
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          type="search"
          value={filter}
          onChange={(e) => update({ q: e.target.value })}
          placeholder="Player or team (LAL)"
          aria-label="Filter players"
          className="min-w-[220px] flex-1 rounded-full border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-emerald-500"
        />
        <select
          aria-label="Season"
          value={season}
          onChange={(e) => update({ season: e.target.value === currentSeason() ? null : e.target.value })}
          className="rounded-full border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500"
        >
          {recentSeasons().map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          aria-label="Minimum minutes per game"
          value={minMinutes}
          onChange={(e) => update({ min: e.target.value === "0" ? null : e.target.value })}
          className="rounded-full border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500"
        >
          {MIN_MINUTES_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m === 0 ? "All minutes" : `${m}+ min/game`}
            </option>
          ))}
        </select>
        <div
          className="flex gap-1 rounded-full border border-slate-700 bg-slate-900 p-1"
          role="group"
          aria-label="Sort by Gravity or by tonight's lean"
        >
          <button
            type="button"
            onClick={() => update({ sort: null, dir: null })}
            aria-pressed={!leanSort}
            className={`rounded-full px-3 py-1 text-xs font-bold transition-colors ${
              !leanSort ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Gravity
          </button>
          <button
            type="button"
            onClick={() => update({ sort: "lean", dir: null })}
            aria-pressed={leanSort}
            disabled={!leansAvailable}
            title={
              leansAvailable
                ? "Sort by tonight's lean: strongest hit-rate estimate vs tonight's line first"
                : "No leans available — leans appear on game days for the current season"
            }
            className={`rounded-full px-3 py-1 text-xs font-bold transition-colors ${
              leanSort ? "bg-emerald-500/80 text-emerald-950" : "text-slate-400 hover:text-white"
            } disabled:cursor-not-allowed disabled:opacity-40`}
          >
            Lean
          </button>
        </div>
      </div>

      {data && leansAvailable && (
        <p className="text-xs text-slate-500">{LEAN_EXPLAINER}</p>
      )}
      {data && leanSort && (
        <p className="rounded-xl border border-emerald-800/60 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200">
          Sorted by tonight&apos;s lean — hit-rate estimate vs tonight&apos;s line, not a guarantee.
        </p>
      )}

      {loading && !data && <Spinner label="Ranking every player…" />}
      {error && <ErrorState error={error} onRetry={retry} />}

      {data && (
        <div className="overflow-x-auto rounded-2xl border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/80 text-xs text-slate-400">
              <tr>
                <th scope="col" className="px-3 py-3 text-left">#</th>
                <th scope="col" className="px-3 py-3 text-left uppercase tracking-wider">Player</th>
                <th
                  scope="col"
                  className="px-3 py-3 text-left uppercase tracking-wider"
                  title="Tonight's lean: the player's strongest hit-rate estimate vs tonight's line — how often their recent games would have cleared it. Past hit rates, not a guarantee."
                >
                  Tonight&apos;s lean
                </th>
                {COLUMNS.map((c) => sortHeader(c.key, c.label, c.title, c.className))}
                {sortHeader("gravity", "Gravity", "Raw Gravity Score")}
                <th scope="col" className="px-3 py-3 text-right uppercase tracking-wider">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {rows.map((p) => (
                <tr key={p.player_id} className="transition-colors hover:bg-slate-900/60">
                  <td className="px-3 py-3 text-slate-500">{p.rank}</td>
                  <td className="px-3 py-3">
                    <Link to={`/players/${p.slug}${season === currentSeason() ? "" : `?season=${season}`}`} className="font-semibold text-white hover:text-emerald-300">
                      {p.player_name}
                    </Link>
                    <span className="ml-2 text-xs text-slate-500">{p.team}</span>
                    <div className="mt-1.5 max-w-[220px]">
                      <StackedBar components={p.components} max={maxGravity} />
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    {(() => {
                      const lean = leanBySlug.get(p.slug);
                      if (!lean) return <span className="text-slate-600">—</span>;
                      return (
                        <>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[0.65rem] font-black uppercase ${
                              lean.direction === "Over" ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"
                            }`}
                          >
                            {lean.direction} {lean.line} {lean.statLabel}
                          </span>
                          <span className="ml-2 font-black tabular-nums text-white">{Math.round(lean.estimate * 100)}%</span>
                          <span
                            className={`ml-1.5 rounded px-1 py-0.5 text-[0.55rem] font-bold uppercase ${
                              lean.lineSource === "book" ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-700/60 text-slate-300"
                            }`}
                            title={lean.lineSource === "book" ? "Sportsbook line" : "No sportsbook line; set at the player's season average"}
                          >
                            {lean.lineSource === "book" ? "Book" : "Avg"}
                          </span>
                        </>
                      );
                    })()}
                  </td>
                  {COLUMNS.map((c) => (
                    <td key={c.key} className={`px-3 py-3 text-right tabular-nums text-slate-300 ${c.className ?? ""}`}>
                      {c.key === "games" ? p.games : fmt(p[c.key])}
                      {c.key === "drives" && p.drives_estimated && (
                        <span className="text-amber-400" title="Estimated from shot attempts">*</span>
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-3 text-right font-semibold tabular-nums text-white">{fmt(p.gravity)}</td>
                  <td className={`px-3 py-3 text-right text-lg font-black tabular-nums ${uvsTone(p.uvs)}`}>{fmt(p.uvs, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="py-10 text-center text-sm text-slate-500">No players match those filters.</p>}
        </div>
      )}
      {data && (
        <p className="text-xs text-slate-500">
          Showing {rows.length} of {data.league_size} players. Rank is league-wide. Score scales raw gravity to 0–100.
        </p>
      )}
    </div>
  );
};

export default Leaderboard;
