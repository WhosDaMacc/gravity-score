import React, { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ErrorState, Spinner } from "../components/StatusViews";
import { useDocumentTitle, usePropsBoard } from "../lib/hooks";
import {
  analyze,
  defaultLine,
  heatStyle,
  lean,
  parseLogs,
  STAT_BY_KEY,
  STATS,
  WINDOWS,
  type GameLog,
  type HitRate,
  type PropAnalysis,
  type PropLine,
  type PropsBoard,
  type PropsPlayer,
  type StatKey,
  type WindowKey,
} from "../lib/props";

type SortKey = "clear" | "line" | "avg10" | WindowKey;
type Row = { player: PropsPlayer; stat: StatKey; book?: PropLine; analysis: PropAnalysis; edited: boolean };

const pct = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);

const HeatCell: React.FC<{ hr: HitRate; className?: string }> = ({ hr, className = "" }) => (
  <td className={`px-1 py-1 ${className}`}>
    <div className="rounded-md px-2 py-1.5 text-center leading-tight" style={heatStyle(hr.rate)}>
      <div className="text-sm font-bold tabular-nums">{pct(hr.rate)}</div>
      <div className="text-[0.65rem] opacity-80 tabular-nums">{hr.n ? `${hr.hits}/${hr.n}` : "no games"}</div>
    </div>
  </td>
);

const ClearCell: React.FC<{ clear: number | null }> = ({ clear }) => {
  const side = lean(clear);
  return (
    <td className="px-2 py-1 text-right">
      <div className="text-lg font-black tabular-nums text-white">{pct(clear)}</div>
      {side && (
        <div className={`text-[0.65rem] font-bold uppercase tracking-wider ${side === "Over" ? "text-emerald-300" : "text-rose-300"}`}>
          {side}
        </div>
      )}
    </td>
  );
};

const Last10: React.FC<{ games: PropAnalysis["last10"]; line: number }> = ({ games, line }) => (
  <div className="flex gap-0.5" aria-label="Last 10 games, oldest to newest">
    {[...games].reverse().map((g) => (
      <span
        key={g.date}
        title={`${g.date} vs ${g.opp}: ${g.value}`}
        className={`flex h-7 w-6 items-center justify-center rounded text-[0.6rem] font-bold tabular-nums ${
          g.value > line ? "bg-emerald-600/70 text-white" : g.value < line ? "bg-rose-700/60 text-rose-100" : "bg-slate-600 text-white"
        }`}
      >
        {g.value}
      </span>
    ))}
  </div>
);

const LineInput: React.FC<{ row: Row; onChange: (v: number | null) => void }> = ({ row, onChange }) => (
  <div className="flex items-center gap-1.5">
    <input
      type="number"
      step={0.5}
      min={0}
      value={row.analysis.line}
      onChange={(e) => {
        const v = Number(e.target.value);
        onChange(Number.isFinite(v) ? v : null);
      }}
      aria-label={`${row.player.name} ${STAT_BY_KEY[row.stat].label} line`}
      className="w-16 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm font-semibold tabular-nums text-white outline-none focus:border-emerald-500"
    />
    {row.edited ? (
      <button type="button" onClick={() => onChange(null)} className="text-[0.6rem] font-bold uppercase text-amber-300 hover:text-white" title="Reset line">
        Edited ×
      </button>
    ) : row.book ? (
      <span
        className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase text-emerald-300"
        title={`${row.book.books} books · range ${row.book.low}–${row.book.high}`}
      >
        Book
      </span>
    ) : (
      <span className="rounded bg-slate-700/60 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase text-slate-300" title="No sportsbook line; set to the player's season average">
        Avg
      </span>
    )}
  </div>
);

function sortValue(row: Row, key: SortKey): number {
  if (key === "clear") return row.analysis.clear ?? -1;
  if (key === "line") return row.analysis.line;
  if (key === "avg10") return row.analysis.avg10 ?? -1;
  return row.analysis.windows[key].rate ?? -1;
}

const Props: React.FC = () => {
  useDocumentTitle("NBA props heat map");
  const { data, loading, error, retry } = usePropsBoard();
  const [params, setParams] = useSearchParams();
  const view = (params.get("stat") ?? "best") as StatKey | "best";
  const gameId = params.get("game") ?? "";
  const query = (params.get("q") ?? "").toLowerCase();
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "clear", asc: false });
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [includeNoLine, setIncludeNoLine] = useState(false);

  const update = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const logsById = useMemo(() => {
    const map = new Map<string, GameLog[]>();
    if (data) for (const p of data.players) map.set(p.id, parseLogs(data, p));
    return map;
  }, [data]);

  const players = useMemo(
    () => (data?.players ?? []).filter(
      (p) => (!gameId || p.game_id === gameId) && (!query || p.name.toLowerCase().includes(query) || p.team.toLowerCase() === query),
    ),
    [data, gameId, query],
  );

  const makeRow = (player: PropsPlayer, stat: StatKey): Row => {
    const logs = logsById.get(player.id) ?? [];
    const book = player.lines[stat];
    const override = overrides[`${player.id}:${stat}`];
    const line = override ?? book?.line ?? defaultLine(logs, stat);
    return { player, stat, book, analysis: analyze(logs, stat, line, player.opp), edited: override !== undefined };
  };

  const setOverride = (row: Row, value: number | null) =>
    setOverrides((prev) => {
      const next = { ...prev };
      const key = `${row.player.id}:${row.stat}`;
      if (value === null) delete next[key];
      else next[key] = value;
      return next;
    });

  const statHasLines = (stat: StatKey) => (data?.players ?? []).some((p) => p.lines[stat]);

  const statRows = useMemo(() => {
    if (!data || view === "best") return [];
    const onlyBook = statHasLines(view) && !includeNoLine;
    const rows = players.filter((p) => !onlyBook || p.lines[view]).map((p) => makeRow(p, view));
    const dir = sort.asc ? 1 : -1;
    return rows.sort((a, b) => dir * (sortValue(a, sort.key) - sortValue(b, sort.key)));
  }, [data, view, players, sort, overrides, includeNoLine, logsById]);

  const best = useMemo(() => {
    if (!data) return { overs: [] as Row[], unders: [] as Row[] };
    const rows = players.flatMap((p) =>
      (Object.keys(p.lines) as StatKey[]).map((stat) => makeRow(p, stat)),
    ).filter((r) => r.analysis.clear !== null && r.analysis.seasonGames >= 3);
    const byClear = [...rows].sort((a, b) => (b.analysis.clear ?? 0) - (a.analysis.clear ?? 0));
    return {
      overs: byClear.filter((r) => (r.analysis.clear ?? 0) >= 0.5).slice(0, 20),
      unders: byClear.filter((r) => (r.analysis.clear ?? 1) < 0.5).reverse().slice(0, 20),
    };
  }, [data, players, overrides, logsById]);

  if (loading && !data) return <Spinner label="Loading tonight's slate…" />;
  if (error) return <ErrorState error={error} onRetry={retry} />;
  if (!data) return null;

  const sortHeader = (key: SortKey, label: string, className = "") => (
    <th scope="col" className={`px-1 py-2 text-center ${className}`}>
      <button
        type="button"
        onClick={() => setSort((s) => ({ key, asc: s.key === key ? !s.asc : false }))}
        className={`whitespace-nowrap uppercase tracking-wider hover:text-white ${sort.key === key ? "text-emerald-300" : ""}`}
      >
        {label}
        {sort.key === key && <span aria-hidden="true">{sort.asc ? " ▲" : " ▼"}</span>}
      </button>
    </th>
  );

  const playerCell = (p: PropsPlayer, extra?: string) => (
    <td className="px-2 py-1">
      <div className="font-semibold text-white">{p.name}</div>
      <div className="text-xs text-slate-500">
        {p.team} {p.home ? "vs" : "@"} {p.opp}
        {extra && <span className="ml-2 font-semibold text-slate-300">{extra}</span>}
      </div>
    </td>
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white">Props heat map</h1>
          <p className="text-sm text-slate-400">
            {new Date(`${data.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} ·{" "}
            {data.games.length} games · how often each player cleared tonight&apos;s line
          </p>
        </div>
        <LinesStatus board={data} />
      </header>

      {data.games.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 p-8 text-center text-slate-400">No NBA games today.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Chip active={!gameId} onClick={() => update("game", null)}>All games</Chip>
            {data.games.map((g) => (
              <Chip key={g.id} active={gameId === g.id} onClick={() => update("game", g.id)}>
                {g.away} @ {g.home}
                <span className="ml-1.5 text-slate-500">
                  {new Date(g.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                </span>
              </Chip>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-1 rounded-2xl border border-slate-800 bg-slate-900/60 p-1">
              <Tab active={view === "best"} onClick={() => update("stat", null)}>Best clears</Tab>
              {STATS.map((s) => (
                <Tab key={s.key} active={view === s.key} onClick={() => update("stat", s.key)} title={s.name}>
                  {s.label}
                  {statHasLines(s.key) && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 align-middle" />}
                </Tab>
              ))}
            </div>
            <input
              type="search"
              value={params.get("q") ?? ""}
              onChange={(e) => update("q", e.target.value)}
              placeholder="Player or team"
              aria-label="Filter players"
              className="w-48 rounded-full border border-slate-700 bg-slate-900 px-4 py-1.5 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-emerald-500"
            />
          </div>

          {view === "best" ? (
            <div className="grid gap-6 xl:grid-cols-2">
              <BestTable title="Most likely to clear" tone="emerald" rows={best.overs} playerCell={playerCell} />
              <BestTable title="Most likely to stay under" tone="rose" rows={best.unders} playerCell={playerCell} />
              {best.overs.length + best.unders.length === 0 && (
                <p className="text-sm text-slate-400 xl:col-span-2">
                  No sportsbook lines are loaded for these games yet. Pick a stat tab to rate players against their season averages, or set your own lines.
                </p>
              )}
            </div>
          ) : (
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
                <p>
                  <span className="font-semibold text-slate-200">{STAT_BY_KEY[view].name}.</span>{" "}
                  {statHasLines(view)
                    ? "Lines are the most common number across sportsbooks."
                    : "No sportsbook lines for this stat, so each line starts at the player's season average."}{" "}
                  Edit any line to recalculate.
                </p>
                {statHasLines(view) && (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={includeNoLine} onChange={(e) => setIncludeNoLine(e.target.checked)} />
                    Include players without a book line
                  </label>
                )}
              </div>
              <div className="overflow-x-auto rounded-2xl border border-slate-800">
                <table className="w-full text-sm">
                  <thead className="bg-slate-900/80 text-xs text-slate-400">
                    <tr>
                      <th scope="col" className="px-2 py-2 text-left uppercase tracking-wider">Player</th>
                      {sortHeader("line", "Line")}
                      {WINDOWS.map((w) => sortHeader(w, w, w === "L20" || w === "H2H" ? "hidden md:table-cell" : ""))}
                      <th scope="col" className="hidden px-2 py-2 text-left uppercase tracking-wider lg:table-cell">Last 10</th>
                      {sortHeader("avg10", "L10 avg", "hidden sm:table-cell")}
                      {sortHeader("clear", "Clear")}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {statRows.map((row) => (
                      <tr key={row.player.id} className="hover:bg-slate-900/50">
                        {playerCell(row.player)}
                        <td className="px-2 py-1"><LineInput row={row} onChange={(v) => setOverride(row, v)} /></td>
                        {WINDOWS.map((w) => (
                          <HeatCell key={w} hr={row.analysis.windows[w]} className={w === "L20" || w === "H2H" ? "hidden md:table-cell" : ""} />
                        ))}
                        <td className="hidden px-2 py-1 lg:table-cell"><Last10 games={row.analysis.last10} line={row.analysis.line} /></td>
                        <td className="hidden px-2 py-1 text-center tabular-nums text-slate-300 sm:table-cell">
                          {row.analysis.avg10 === null ? "—" : row.analysis.avg10.toFixed(1)}
                        </td>
                        <ClearCell clear={row.analysis.clear} />
                      </tr>
                    ))}
                  </tbody>
                </table>
                {statRows.length === 0 && <p className="py-10 text-center text-sm text-slate-500">No players match.</p>}
              </div>
            </section>
          )}

          <Methodology />
        </>
      )}
    </div>
  );
};

const Chip: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
      active ? "border-emerald-500 bg-emerald-500/15 text-emerald-200" : "border-slate-700 text-slate-300 hover:bg-slate-800"
    }`}
  >
    {children}
  </button>
);

const Tab: React.FC<{ active: boolean; onClick: () => void; title?: string; children: React.ReactNode }> = ({ active, onClick, title, children }) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    className={`rounded-xl px-2.5 py-1 text-xs font-bold transition-colors ${
      active ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"
    }`}
  >
    {children}
  </button>
);

const LinesStatus: React.FC<{ board: PropsBoard }> = ({ board }) => {
  if (!board.lines) {
    return (
      <p className="max-w-sm rounded-xl border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
        Sportsbook lines haven&apos;t been loaded today. Every stat uses season-average lines until they are.
      </p>
    );
  }
  const names = board.lines.markets.map((m) => STAT_BY_KEY[m].label).join(", ");
  return (
    <p className="max-w-sm text-right text-xs text-slate-400">
      Sportsbook lines: <span className="font-semibold text-slate-200">{names || "none"}</span>, updated{" "}
      {new Date(board.lines.fetched_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.
      {" "}Other stats start at season averages.
    </p>
  );
};

const BestTable: React.FC<{
  title: string;
  tone: "emerald" | "rose";
  rows: Row[];
  playerCell: (p: PropsPlayer, extra?: string) => React.ReactNode;
}> = ({ title, tone, rows, playerCell }) => {
  if (!rows.length) return null;
  return (
    <section className="space-y-2">
      <h2 className={`text-sm font-bold uppercase tracking-widest ${tone === "emerald" ? "text-emerald-300" : "text-rose-300"}`}>{title}</h2>
      <div className="overflow-x-auto rounded-2xl border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/80 text-xs uppercase tracking-wider text-slate-400">
            <tr>
              <th scope="col" className="px-2 py-2 text-left">Player · prop</th>
              {WINDOWS.map((w) => (
                <th key={w} scope="col" className={`px-1 py-2 text-center ${w === "L20" || w === "H2H" ? "hidden sm:table-cell" : ""}`}>{w}</th>
              ))}
              <th scope="col" className="px-2 py-2 text-right">Clear</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {rows.map((row) => (
              <tr key={`${row.player.id}:${row.stat}`} className="hover:bg-slate-900/50">
                {playerCell(row.player, `${STAT_BY_KEY[row.stat].label} ${row.analysis.line}`)}
                {WINDOWS.map((w) => (
                  <HeatCell key={w} hr={row.analysis.windows[w]} className={w === "L20" || w === "H2H" ? "hidden sm:table-cell" : ""} />
                ))}
                <ClearCell clear={row.analysis.clear} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

const Methodology: React.FC = () => (
  <details className="rounded-2xl border border-slate-800 bg-slate-900/30 p-4 text-sm text-slate-400">
    <summary className="cursor-pointer font-semibold text-slate-200">How &ldquo;Clear %&rdquo; works</summary>
    <div className="mt-3 space-y-2">
      <p>
        Each cell is how often the player went <em>over</em> the line: L5/L10/L20 are the last 5, 10 and 20 games (reaching into
        last season early on), SZN is this season, and H2H is every game against tonight&apos;s opponent since last season.
        A result exactly on a whole-number line is a push and isn&apos;t counted.
      </p>
      <p>
        Clear % blends them: L10 30%, L5 25%, L20 20%, season 15%, head-to-head 10% (less with fewer than 3 meetings), then
        pulls toward 50% when there are few recent games. 62% or higher is marked Over, 38% or lower Under.
      </p>
      <p>Hit rates describe the past, not a guarantee. Minutes, injuries and matchups change. Not betting advice.</p>
    </div>
  </details>
);

export default Props;
