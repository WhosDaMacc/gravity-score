import React, { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ComponentLegend, StackedBar } from "../components/GravityBars";
import { DataSourceNote, ErrorState, Spinner } from "../components/StatusViews";
import type { PlayerRow } from "../lib/api";
import { currentSeason, fmt, recentSeasons, slugify, uvsTone } from "../lib/format";
import { useDocumentTitle, useLeaderboard } from "../lib/hooks";

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
  const sort = (params.get("sort") as SortKey | null) ?? "gravity";
  const asc = params.get("dir") === "asc";
  const filter = params.get("q") ?? "";
  const minMinutes = Number(params.get("min") ?? 0);

  useDocumentTitle(`NBA Gravity Leaderboard ${season}`);
  const { data, loading, error, retry } = useLeaderboard(season);

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  const setSort = (key: SortKey) => {
    if (key === sort) update({ dir: asc ? null : "asc" });
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
    const dir = asc ? 1 : -1;
    return [...filtered].sort((a: PlayerRow, b: PlayerRow) => dir * (a[sort] - b[sort]) || a.rank - b.rank);
  }, [data, filter, minMinutes, sort, asc]);

  const maxGravity = data?.players[0]?.gravity ?? 1;

  const sortHeader = (k: SortKey, label: string, title: string, className = "") => (
    <th key={k} scope="col" className={`px-3 py-3 text-right ${className}`} aria-sort={sort === k ? (asc ? "ascending" : "descending") : "none"}>
      <button type="button" title={title} onClick={() => setSort(k)} className={`whitespace-nowrap uppercase tracking-wider hover:text-white ${sort === k ? "text-emerald-300" : ""}`}>
        {label}
        {sort === k && <span aria-hidden="true">{asc ? " ▲" : " ▼"}</span>}
      </button>
    </th>
  );

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
      </div>

      {loading && !data && <Spinner label="Ranking every player…" />}
      {error && <ErrorState error={error} onRetry={retry} />}

      {data && (
        <div className="overflow-x-auto rounded-2xl border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/80 text-xs text-slate-400">
              <tr>
                <th scope="col" className="px-3 py-3 text-left">#</th>
                <th scope="col" className="px-3 py-3 text-left uppercase tracking-wider">Player</th>
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
