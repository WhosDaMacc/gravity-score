import React, { Fragment, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import BetModal, { type BetTarget } from "../components/BetModal";
import ParlaySlip from "../components/ParlaySlip";
import { ErrorState, Spinner } from "../components/StatusViews";
import { ordinal } from "../lib/format";
import { useDocumentTitle, useKalshi, usePropsBoard } from "../lib/hooks";
import { legId, parlay, useParlay, type ParlayLeg } from "../lib/parlay";
import {
  analyze,
  defaultLine,
  heatStyle,
  lean,
  matchupFor,
  matchupTone,
  parseLogs,
  POSITION_NAMES,
  positionGroup,
  spreadUsed,
  STAT_BY_KEY,
  SPORT_LABELS,
  SPORT_STATS,
  WINDOWS,
  type GameLog,
  type HitRate,
  type Matchup,
  type PropAnalysis,
  type PropLine,
  type PropsBoard,
  type PropsPlayer,
  type StatKey,
  type WindowKey,
} from "../lib/props";

type SortKey = "prob" | "clear" | "line" | "proj" | "matchup" | WindowKey;

const STAT_TABLE_COLUMNS = 13;
type Row = { player: PropsPlayer; stat: StatKey; book?: PropLine; analysis: PropAnalysis; edited: boolean };

const pct = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);
const signedPct = (factor: number) => {
  const p = Math.round((factor - 1) * 100);
  return p === 0 ? "0%" : `${p > 0 ? "+" : "−"}${Math.abs(p)}%`;
};
const rowKey = (row: Row) => `${row.player.id}:${row.stat}`;

const HeatCell: React.FC<{ hr: HitRate; className?: string }> = ({ hr, className = "" }) => (
  <td className={`px-1 py-1 ${className}`}>
    <div className="rounded-md px-2 py-1.5 text-center leading-tight" style={heatStyle(hr.rate)}>
      <div className="text-sm font-bold tabular-nums">{pct(hr.rate)}</div>
      <div className="text-[0.65rem] opacity-80 tabular-nums">{hr.n ? `${hr.hits}/${hr.n}` : "no games"}</div>
    </div>
  </td>
);

const MatchupBadge: React.FC<{ m: Matchup | null; opp: string }> = ({ m, opp }) => (
  <div
    className={`inline-flex flex-col rounded-md px-2 py-1 text-center leading-tight ${matchupTone(m)}`}
    title={m ? `${opp} allows ${m.allowed.toFixed(1)} per game (league ${m.league.toFixed(1)}). Rank: 1st allows the least.` : "No defense data yet"}
  >
    <span className="text-sm font-bold tabular-nums">{m ? signedPct(m.factor) : "—"}</span>
    <span className="text-[0.6rem] opacity-80">{m ? `${opp} ${ordinal(m.rank)}` : ""}</span>
  </div>
);

const ProbCell: React.FC<{ prob: number | null }> = ({ prob }) => {
  const side = lean(prob);
  return (
    <td className="px-2 py-1 text-right">
      <div className="text-lg font-black tabular-nums text-white">{pct(prob)}</div>
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
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const v = Number(e.target.value);
        onChange(Number.isFinite(v) ? v : null);
      }}
      aria-label={`${row.player.name} ${STAT_BY_KEY[row.stat].label} line`}
      className="w-16 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm font-semibold tabular-nums text-white outline-none focus:border-emerald-500"
    />
    {row.edited ? (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onChange(null);
        }}
        className="whitespace-nowrap text-[0.6rem] font-bold uppercase text-amber-300 hover:text-white"
        title="Reset line"
      >
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

const MatchupDetail: React.FC<{ row: Row; compact?: boolean }> = ({ row, compact }) => {
  const { analysis: a, player } = row;
  const stat = STAT_BY_KEY[row.stat];
  const m = a.matchup;
  const p = a.projection;
  const fmt1 = (v: number | null) => (v === null ? "—" : v.toFixed(1));
  return (
    <div className={`grid gap-4 p-4 text-sm text-slate-300 ${compact ? "" : "md:grid-cols-3"}`}>
      <div>
        <h3 className="mb-1 text-xs font-bold uppercase tracking-widest text-slate-500">Projection</h3>
        {p ? (
          <p>
            Recent form <span className="font-semibold text-white">{fmt1(p.base)}</span> {stat.label}{" "}
            <span className="text-slate-500">(L5 {fmt1(p.l5)} · L10 {fmt1(p.l10)} · season {fmt1(p.season)})</span>
            {m && <> × matchup {m.factor.toFixed(2)}</>} ={" "}
            <span className="font-semibold text-white">{p.adjusted.toFixed(1)}</span> projected, modeled at ±
            {spreadUsed(p.adjusted, p.sd).toFixed(1)} game to game
            {p.adjusted < 6 && " (low-count stat)"}. Chance of going over {a.line}:{" "}
            <span className="font-bold text-white">{pct(a.prob)}</span>
            {a.prob !== null && a.prob > 0.65 && <span className="text-slate-500"> (tempered at the high end, see below)</span>}.
          </p>
        ) : (
          <p>Not enough games to project.</p>
        )}
      </div>
      <div>
        <h3 className="mb-1 text-xs font-bold uppercase tracking-widest text-slate-500">{player.opp} defense</h3>
        {m ? (
          <div className="space-y-1.5">
            <p>
              Allows <span className="font-semibold text-white">{m.allowed.toFixed(1)}</span> {stat.label} per game, league
              average {m.league.toFixed(1)} ({signedPct(m.rawFactor)}): {ordinal(m.rank)} of {m.teams}, where 1st allows the
              least. Over {m.games} games, so the projection uses {signedPct(m.factor)}
              {m.games < 20 && ", scaled back toward average for the small sample"}.
            </p>
            {a.positionMatchup && (
              <p className="text-slate-400">
                Vs {POSITION_NAMES[a.positionMatchup.group]}: {a.positionMatchup.allowed.toFixed(1)} per game vs league{" "}
                {a.positionMatchup.league.toFixed(1)} ({signedPct(a.positionMatchup.rawFactor)},{" "}
                {ordinal(a.positionMatchup.rank)}). Shown for context; by-position splits were too noisy to improve the
                probability in testing.
              </p>
            )}
          </div>
        ) : (
          <p>No defense data for {player.opp} yet.</p>
        )}
      </div>
      <div>
        <h3 className="mb-1 text-xs font-bold uppercase tracking-widest text-slate-500">
          {player.name.split(" ").slice(-1)[0]} vs {player.opp}
        </h3>
        {a.h2hGames.length ? (
          <ul className="space-y-0.5">
            {a.h2hGames.map((g) => (
              <li key={g.date} className="flex justify-between gap-3 tabular-nums">
                <span className="text-slate-500">
                  {g.date}
                  {g.prevSeason && " (last season)"}
                </span>
                <span className={g.value > a.line ? "font-semibold text-emerald-300" : g.value < a.line ? "text-rose-300" : "text-slate-300"}>
                  {g.value} {g.value > a.line ? "over" : g.value < a.line ? "under" : "push"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-slate-500">No games against {player.opp} since last season.</p>
        )}
      </div>
    </div>
  );
};

function sortValue(row: Row, key: SortKey): number {
  const a = row.analysis;
  if (key === "prob") return a.prob ?? -1;
  if (key === "clear") return a.clear ?? -1;
  if (key === "line") return a.line;
  if (key === "proj") return a.projection?.adjusted ?? -1;
  if (key === "matchup") return a.matchup?.factor ?? 0;
  return a.windows[key].rate ?? -1;
}

const Props: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const sport = params.get("sport") ?? "nba";
  const stats = SPORT_STATS[sport] ?? SPORT_STATS.nba;
  useDocumentTitle(`${SPORT_LABELS[sport] ?? "NBA"} props heat map`);
  const { data, loading, error, retry } = usePropsBoard(sport);
  const viewParam = (params.get("stat") ?? "best") as StatKey | "best";
  // A stale link can pair one sport with the other's stat tab; fall back to Best clears.
  const view = viewParam === "best" || stats.some((s) => s.key === viewParam) ? viewParam : "best";
  const gameId = params.get("game") ?? "";
  const query = (params.get("q") ?? "").toLowerCase();
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "prob", asc: false });
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [includeNoLine, setIncludeNoLine] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [betTarget, setBetTarget] = useState<BetTarget | null>(null);
  const { data: kalshi } = useKalshi(sport === "nba");
  const legs = useParlay();

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

  const makeRow = (player: PropsPlayer, stat: StatKey, lineOverrides = overrides): Row => {
    const logs = logsById.get(player.id) ?? [];
    const book = player.lines[stat];
    const override = lineOverrides[`${player.id}:${stat}`];
    const line = override ?? book?.line ?? defaultLine(logs, stat);
    const defense = data?.defense ?? null;
    const matchup = defense ? matchupFor(defense, player.opp, "ALL", stat) : null;
    const group = positionGroup(player.pos);
    const posMatchup = defense && group !== "ALL" ? matchupFor(defense, player.opp, group, stat) : null;
    return {
      player,
      stat,
      book,
      analysis: analyze(logs, stat, line, player.opp, matchup, posMatchup),
      edited: override !== undefined,
    };
  };

  const setOverride = (row: Row, value: number | null) =>
    setOverrides((prev) => {
      const next = { ...prev };
      if (value === null) delete next[rowKey(row)];
      else next[rowKey(row)] = value;
      return next;
    });

  const statHasLines = (stat: StatKey) => (data?.players ?? []).some((p) => p.lines[stat]);

  // Row order is fixed when the sort, stat or filters change, not while a line
  // is being edited; otherwise the edited row jumps away mid-typing.
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;

  const rowOrder = useMemo(() => {
    if (!data || view === "best") return [];
    const onlyBook = statHasLines(view) && !includeNoLine;
    const rows = players.filter((p) => !onlyBook || p.lines[view]).map((p) => makeRow(p, view, overridesRef.current));
    const dir = sort.asc ? 1 : -1;
    return rows.sort((a, b) => dir * (sortValue(a, sort.key) - sortValue(b, sort.key))).map((r) => r.player);
  }, [data, view, players, sort, includeNoLine, logsById]);

  const statRows = useMemo(
    () => (view === "best" ? [] : rowOrder.map((p) => makeRow(p, view))),
    [rowOrder, view, overrides],
  );

  const playersById = useMemo(() => new Map((data?.players ?? []).map((p) => [p.id, p])), [data]);

  const kalshiMarkets = (playerId: string, stat: StatKey) => kalshi?.players[playerId]?.[stat] ?? [];

  const openBet = (row: Row) => {
    if (!data) return;
    const { player, stat, analysis } = row;
    setBetTarget({
      name: player.name,
      stat,
      line: analysis.line,
      offers: player.lines[stat]?.offers ?? [],
      kalshi: kalshiMarkets(player.id, stat),
      leg: {
        sport, playerId: player.id, name: player.name, team: player.team, opp: player.opp, stat,
        line: analysis.line, side: analysis.prob !== null && analysis.prob < 0.5 ? "Under" : "Over",
        date: data.date, probOver: analysis.prob,
      },
    });
  };

  const addToParlay = (row: Row) => {
    if (!data) return;
    const prob = row.analysis.prob;
    parlay.add({
      sport,
      date: data.date,
      playerId: row.player.id,
      name: row.player.name,
      team: row.player.team,
      opp: row.player.opp,
      stat: row.stat,
      line: row.analysis.line,
      side: prob !== null && prob < 0.5 ? "Under" : "Over",
      probOver: prob,
    });
  };

  const legProb = (leg: ParlayLeg): number | null => {
    const player = data && leg.date === data.date ? playersById.get(leg.playerId) : undefined;
    if (!player) return leg.probOver;
    return makeRow(player, leg.stat, { [`${player.id}:${leg.stat}`]: leg.line }).analysis.prob;
  };

  const inParlay = (row: Row) => !!data && legs.some((l) => l.id === legId(data.date, row.player.id, row.stat));

  const actionsCell = (row: Row) => (
    <td className="px-2 py-1">
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={() => openBet(row)}
          className="rounded-md border border-emerald-600/70 bg-emerald-500/10 px-2 py-1 text-xs font-bold text-emerald-200 hover:bg-emerald-500/20"
        >
          Bet
        </button>
        <button
          type="button"
          onClick={() => addToParlay(row)}
          title={inParlay(row) ? "In your phantom parlay (click to update the line)" : "Add to phantom parlay"}
          aria-label={`Add ${row.player.name} ${STAT_BY_KEY[row.stat].label} to phantom parlay`}
          className={`rounded-md border px-2 py-1 text-xs font-bold ${
            inParlay(row) ? "border-violet-400 bg-violet-500/25 text-violet-100" : "border-slate-600 text-slate-300 hover:bg-slate-800"
          }`}
        >
          {inParlay(row) ? "✓" : "+"}
        </button>
      </div>
    </td>
  );

  const best = useMemo(() => {
    if (!data) return { overs: [] as Row[], unders: [] as Row[] };
    const rows = players
      .flatMap((p) => (Object.keys(p.lines) as StatKey[]).map((stat) => makeRow(p, stat)))
      .filter((r) => r.analysis.prob !== null && r.analysis.seasonGames >= 3);
    const byProb = [...rows].sort((a, b) => (b.analysis.prob ?? 0) - (a.analysis.prob ?? 0));
    return {
      overs: byProb.filter((r) => (r.analysis.prob ?? 0) >= 0.5).slice(0, 20),
      unders: byProb.filter((r) => (r.analysis.prob ?? 1) < 0.5).reverse().slice(0, 20),
    };
  }, [data, players, overrides, logsById]);

  if (loading && !data) return <Spinner label="Loading tonight's slate…" />;
  if (error) return <ErrorState error={error} onRetry={retry} />;
  if (!data) return null;

  const sortHeader = (key: SortKey, label: string, className = "", title?: string) => (
    <th scope="col" className={`px-1 py-2 text-center ${className}`}>
      <button
        type="button"
        title={title}
        onClick={() => setSort((s) => ({ key, asc: s.key === key ? !s.asc : false }))}
        className={`whitespace-nowrap uppercase tracking-wider hover:text-white ${sort.key === key ? "text-emerald-300" : ""}`}
      >
        {label}
        {sort.key === key && <span aria-hidden="true">{sort.asc ? " ▲" : " ▼"}</span>}
      </button>
    </th>
  );

  const playerCell = (row: Row, extra?: string) => {
    const p = row.player;
    const open = expanded === rowKey(row);
    return (
      <td className="min-w-[12rem] px-2 py-1">
        <button
          type="button"
          onClick={() => setExpanded(open ? null : rowKey(row))}
          aria-expanded={open}
          className="text-left"
        >
          <div className="whitespace-nowrap font-semibold text-white hover:text-emerald-300">
            <span className="mr-1 inline-block w-3 text-slate-500">{open ? "▾" : "▸"}</span>
            {p.name}
          </div>
          <div className="pl-4 text-xs text-slate-500">
            {p.pos && `${p.pos} · `}{p.team} {p.home ? "vs" : "@"} {p.opp}
            {extra && <span className="ml-2 font-semibold text-slate-300">{extra}</span>}
          </div>
        </button>
      </td>
    );
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white">Props heat map</h1>
          <p className="text-sm text-slate-400">
            {new Date(`${data.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} ·{" "}
            {data.games.length} games · hit rates and {sport === "nba" ? "matchup-adjusted chances" : "chances"} to clear tonight&apos;s line
          </p>
        </div>
        <LinesStatus board={data} />
      </header>

      <div className="flex gap-1 rounded-2xl border border-slate-800 bg-slate-900/60 p-1">
        {(["nba", "nfl"] as const).map((s) => (
          <Tab
            key={s}
            active={sport === s}
            onClick={() => setParams(new URLSearchParams({ sport: s }), { replace: true })}
          >
            {SPORT_LABELS[s]}
          </Tab>
        ))}
      </div>

      {data.games.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 p-8 text-center text-slate-400">
          No {SPORT_LABELS[sport] ?? "NBA"} games today.
        </p>
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
              {stats.map((s) => (
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
              <BestTable title="Most likely to clear" tone="emerald" rows={best.overs} playerCell={playerCell} actionsCell={actionsCell} expanded={expanded} />
              <BestTable title="Most likely to stay under" tone="rose" rows={best.unders} playerCell={playerCell} actionsCell={actionsCell} expanded={expanded} />
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
                  Edit any line to recalculate; click a player for the matchup breakdown.
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
                      {sortHeader("matchup", "Matchup", "", "How much the opponent allows this stat to the player's position vs league average")}
                      {WINDOWS.map((w) => sortHeader(w, w, w === "L20" || w === "H2H" ? "hidden md:table-cell" : ""))}
                      <th scope="col" className="hidden px-2 py-2 text-left uppercase tracking-wider xl:table-cell">Last 10</th>
                      {sortHeader("proj", "Proj", "hidden sm:table-cell", "Matchup-adjusted projection")}
                      {sortHeader("clear", "Hit %", "hidden sm:table-cell", "Blended hit rate vs this line")}
                      {sortHeader("prob", "Prob", "", "Chance to go over vs tonight's opponent")}
                      <th scope="col" className="px-2 py-2"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {statRows.map((row) => (
                      <Fragment key={row.player.id}>
                        <tr className="hover:bg-slate-900/50">
                          {playerCell(row)}
                          <td className="px-2 py-1"><LineInput row={row} onChange={(v) => setOverride(row, v)} /></td>
                          <td className="px-1 py-1 text-center"><MatchupBadge m={row.analysis.matchup} opp={row.player.opp} /></td>
                          {WINDOWS.map((w) => (
                            <HeatCell key={w} hr={row.analysis.windows[w]} className={w === "L20" || w === "H2H" ? "hidden md:table-cell" : ""} />
                          ))}
                          <td className="hidden px-2 py-1 xl:table-cell"><Last10 games={row.analysis.last10} line={row.analysis.line} /></td>
                          <td className="hidden px-2 py-1 text-center tabular-nums text-slate-200 sm:table-cell">
                            {row.analysis.projection ? row.analysis.projection.adjusted.toFixed(1) : "—"}
                          </td>
                          <td className="hidden px-2 py-1 text-center font-semibold tabular-nums text-slate-300 sm:table-cell">{pct(row.analysis.clear)}</td>
                          <ProbCell prob={row.analysis.prob} />
                          {actionsCell(row)}
                        </tr>
                        {expanded === rowKey(row) && (
                          <tr className="bg-slate-900/60">
                            <td colSpan={STAT_TABLE_COLUMNS}><MatchupDetail row={row} /></td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
                {statRows.length === 0 && <p className="py-10 text-center text-sm text-slate-500">No players match.</p>}
              </div>
            </section>
          )}

          {sport === "nba" && <Methodology />}
        </>
      )}

      {betTarget && <BetModal target={betTarget} onClose={() => setBetTarget(null)} />}
      <ParlaySlip
        legs={legs}
        boardDate={data.date}
        probFor={legProb}
        marketsFor={(leg) => kalshiMarkets(leg.playerId, leg.stat)}
        onBet={(leg) => {
          const player = playersById.get(leg.playerId);
          setBetTarget({
            name: leg.name,
            stat: leg.stat,
            line: leg.line,
            offers: player?.lines[leg.stat]?.offers ?? [],
            kalshi: kalshiMarkets(leg.playerId, leg.stat),
            leg: { ...leg, probOver: legProb(leg) },
          });
        }}
      />
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
  expanded: string | null;
  playerCell: (row: Row, extra?: string) => React.ReactNode;
  actionsCell: (row: Row) => React.ReactNode;
}> = ({ title, tone, rows, expanded, playerCell, actionsCell }) => {
  if (!rows.length) return null;
  return (
    <section className="space-y-2">
      <h2 className={`text-sm font-bold uppercase tracking-widest ${tone === "emerald" ? "text-emerald-300" : "text-rose-300"}`}>{title}</h2>
      <div className="overflow-x-auto rounded-2xl border border-slate-800">
        <table className="w-full text-sm">
          <thead className="whitespace-nowrap bg-slate-900/80 text-xs uppercase tracking-wider text-slate-400">
            <tr>
              <th scope="col" className="px-2 py-2 text-left">Player · prop</th>
              <th scope="col" className="px-1 py-2 text-center">Matchup</th>
              {(["L5", "L10", "H2H"] as WindowKey[]).map((w) => (
                <th key={w} scope="col" className={`px-1 py-2 text-center ${w === "H2H" ? "hidden sm:table-cell" : ""}`}>{w}</th>
              ))}
              <th scope="col" className="hidden px-1 py-2 text-center sm:table-cell">Hit %</th>
              <th scope="col" className="px-2 py-2 text-right">Prob</th>
              <th scope="col" className="px-2 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {rows.map((row) => (
              <Fragment key={rowKey(row)}>
                <tr className="hover:bg-slate-900/50">
                  {playerCell(row, `${STAT_BY_KEY[row.stat].label} ${row.analysis.line}`)}
                  <td className="px-1 py-1 text-center"><MatchupBadge m={row.analysis.matchup} opp={row.player.opp} /></td>
                  {(["L5", "L10", "H2H"] as WindowKey[]).map((w) => (
                    <HeatCell key={w} hr={row.analysis.windows[w]} className={w === "H2H" ? "hidden sm:table-cell" : ""} />
                  ))}
                  <td className="hidden px-1 py-1 text-center font-semibold tabular-nums text-slate-300 sm:table-cell">{pct(row.analysis.clear)}</td>
                  <ProbCell prob={row.analysis.prob} />
                  {actionsCell(row)}
                </tr>
                {expanded === rowKey(row) && (
                  <tr className="bg-slate-900/60">
                    <td colSpan={8}><MatchupDetail row={row} compact /></td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

const Methodology: React.FC = () => (
  <details className="rounded-2xl border border-slate-800 bg-slate-900/30 p-4 text-sm text-slate-400">
    <summary className="cursor-pointer font-semibold text-slate-200">How Matchup, Hit % and Prob work</summary>
    <div className="mt-3 space-y-2">
      <p>
        <span className="font-semibold text-slate-200">Hit cells</span> show how often the player went <em>over</em> the line:
        L5/L10/L20 are the last 5, 10 and 20 games (reaching into last season early on), SZN is this season, and H2H is every
        game against tonight&apos;s opponent since last season. A result exactly on a whole-number line is a push and isn&apos;t
        counted. <span className="font-semibold text-slate-200">Hit %</span> blends them (L10 30%, L5 25%, L20 20%, season 15%,
        head-to-head 10%).
      </p>
      <p>
        <span className="font-semibold text-slate-200">Matchup</span> compares how much of this stat tonight&apos;s opponent
        allows per game with the league average this season. Green means a soft matchup for the over, red a tough one. The
        rank runs from 1st (allows the least) to 30th, and the adjustment is scaled back toward average while a team has
        played few games. Click a player to also see the opponent&apos;s numbers against their position.
      </p>
      <p>
        <span className="font-semibold text-slate-200">Prob</span> is the chance of going over vs this opponent: recent form
        (L10 50%, season 30%, L5 20%) times the matchup adjustment gives a projection, and the player&apos;s own game-to-game
        spread turns that into a probability (low-count stats under 6 per game use a Poisson curve instead). Raw chances
        above 65% came in lower in testing, so the top end is tempered. 62% or higher is marked Over, 38% or lower Under.
        Hit % and Prob can disagree: Hit % only counts past results against this exact line, while Prob also weighs how
        far the projection sits from the line and the matchup.
      </p>
      <p>
        Tested on every 2025-26 game from December on (about 61,000 player-props, using only data available before each
        game), the matchup adjustment improved accuracy for points, rebounds, assists, threes and PRA, and the
        probabilities were well calibrated: picks rated 60–70% went over 65% of the time.
      </p>
      <p>These describe tendencies, not guarantees. Minutes, injuries and rotations change. Not betting advice.</p>
    </div>
  </details>
);

export default Props;
