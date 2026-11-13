import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ComponentBreakdown, StackedBar } from "../components/GravityBars";
import PlayerSearch from "../components/PlayerSearch";
import { DataSourceNote, ErrorState, Spinner } from "../components/StatusViews";
import { currentSeason, fmt, ordinal, slugify, uvsTone } from "../lib/format";
import { useDocumentTitle, useLeaderboard, usePlayer, usePropsBoard } from "../lib/hooks";
import { directionalHits, directionalRate, leansByPlayer, playerNameKey } from "../lib/picks";
import type { WindowKey } from "../lib/props";

const pct = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);

const ScoreRing: React.FC<{ uvs: number }> = ({ uvs }) => {
  const r = 52;
  const circumference = 2 * Math.PI * r;
  return (
    <div className="relative h-36 w-36 shrink-0">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#1e293b" strokeWidth="10" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="url(#ring)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - uvs / 100)}
        />
        <defs>
          <linearGradient id="ring" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-4xl font-black ${uvsTone(uvs)}`}>{fmt(uvs, 0)}</span>
        <span className="text-[0.65rem] uppercase tracking-widest text-slate-500">of 100</span>
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; note?: string }> = ({ label, value, note }) => (
  <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3">
    <p className="text-[0.65rem] uppercase tracking-widest text-slate-500">{label}</p>
    <p className="mt-1 text-xl font-bold tabular-nums text-white">
      {value}
      {note && <span className="ml-1 text-sm text-amber-400">*</span>}
    </p>
  </div>
);

const Player: React.FC = () => {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const season = params.get("season") ?? currentSeason();
  const navigate = useNavigate();
  const { data, loading, error, retry } = usePlayer(slug, season);
  const board = useLeaderboard(season);
  const tonight = usePropsBoard("nba");
  const leanPropsByPlayer = useMemo(
    () => (tonight.data && tonight.data.games.length ? leansByPlayer(tonight.data) : null),
    [tonight.data],
  );
  const [copied, setCopied] = useState(false);

  const player = data?.player;
  useDocumentTitle(
    player ? `${player.player_name} Gravity Score` : error?.status === 404 ? "Player not found" : "Player",
  );

  useEffect(() => {
    if (player && player.slug !== slug) {
      navigate(`/players/${player.slug}${params.toString() ? `?${params}` : ""}`, { replace: true });
    }
  }, [player, slug, params, navigate]);

  if (loading && !data) return <Spinner label="Loading player…" />;

  if (error?.status === 409) {
    return (
      <div className="mx-auto max-w-xl space-y-4 py-10">
        <h1 className="text-2xl font-bold text-white">Which player did you mean?</h1>
        <ul className="divide-y divide-slate-800 rounded-2xl border border-slate-800">
          {error.candidates.map((name) => (
            <li key={name}>
              <Link to={`/players/${slugify(name)}`} className="block px-4 py-3 text-slate-200 hover:bg-slate-900">
                {name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (error?.status === 404) {
    return (
      <div className="mx-auto max-w-xl space-y-4 py-10 text-center">
        <h1 className="text-2xl font-bold text-white">Player not found</h1>
        <p className="text-slate-400">We couldn&apos;t find &ldquo;{slug.replace(/-/g, " ")}&rdquo; in {season} NBA stats.</p>
        <PlayerSearch autoFocus size="lg" />
      </div>
    );
  }

  if (error) return <ErrorState error={error} onRetry={retry} />;
  if (!data || !player) return null;

  const neighbors = (board.data?.players ?? []).filter(
    (p) => Math.abs(p.rank - player.rank) <= 2 && p.player_id !== player.player_id,
  );
  const maxGravity = board.data?.players[0]?.gravity ?? player.gravity;

  // Tonight's lean card: only for the current season, only when this player
  // is on tonight's board with at least one qualifying prop. The board
  // carries names while this page is keyed by slug: exact slugified-name
  // match first, then the suffix-normalized key (playerNameKey) when it
  // matches exactly one board player. Otherwise the card is omitted.
  const tonightPlayer = (() => {
    if (season !== currentSeason() || !tonight.data) return undefined;
    const exact = tonight.data.players.find((p) => slugify(p.name) === player.slug);
    if (exact) return exact;
    const key = playerNameKey(player.slug);
    const candidates = tonight.data.players.filter((p) => playerNameKey(p.name) === key);
    return candidates.length === 1 ? candidates[0] : undefined;
  })();
  const leanProps = tonightPlayer ? leanPropsByPlayer?.get(tonightPlayer.id) ?? [] : [];

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-8">
      <Link to="/leaderboard" className="text-sm text-slate-400 hover:text-white">
        ← Leaderboard
      </Link>

      <section className="flex flex-col gap-8 rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-6 sm:flex-row sm:items-center sm:p-10">
        <ScoreRing uvs={player.uvs} />
        <div className="flex-1">
          <p className="text-sm font-semibold uppercase tracking-widest text-emerald-400">{player.team}</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-white sm:text-4xl">{player.player_name}</h1>
          <p className="mt-3 text-slate-300">
            <span className="font-bold text-white">#{player.rank}</span> of {data.league_size} in Gravity ·{" "}
            {ordinal(Math.round(player.percentile))} percentile · raw score {fmt(player.gravity)}
          </p>
          <div className="mt-2">
            <DataSourceNote meta={data} />
          </div>
        </div>
        <button
          type="button"
          onClick={share}
          className="self-start rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-slate-300 hover:bg-slate-800"
        >
          {copied ? "Link copied" : "Share"}
        </button>
      </section>

      {tonightPlayer && leanProps.length > 0 && (
        <section className="rounded-2xl border border-emerald-900/60 bg-slate-900/30 p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-white">Tonight&apos;s lean</h2>
              <p className="mt-1 text-sm text-slate-400">
                {tonightPlayer.team} {tonightPlayer.home ? "vs" : "@"} {tonightPlayer.opp} · every qualifying prop,
                strongest first
              </p>
            </div>
            <Link
              to="/picks"
              className="rounded-full bg-emerald-500 px-4 py-2 text-xs font-bold text-emerald-950 transition-colors hover:bg-emerald-400"
            >
              See Suggested Bets →
            </Link>
          </div>
          <ul className="mt-4 divide-y divide-slate-800/70">
            {leanProps.map((pick, i) => (
              <li
                key={pick.key}
                className={`flex flex-wrap items-center gap-x-4 gap-y-2 py-3 ${
                  i === 0 ? "rounded-xl border border-emerald-700/60 bg-emerald-950/20 px-3" : ""
                }`}
              >
                <div className="min-w-[200px] flex-1">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[0.65rem] font-black uppercase ${
                      pick.direction === "Over" ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"
                    }`}
                  >
                    {pick.direction} {pick.line} {pick.statLabel}
                  </span>
                  <span className="ml-2 text-sm text-slate-400">{pick.statName}</span>
                  {i === 0 && (
                    <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase text-emerald-300">
                      Strongest lean
                    </span>
                  )}
                  {pick.lineSource === "book" ? (
                    <span className="ml-1.5 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase text-emerald-300">
                      Book
                    </span>
                  ) : (
                    <span
                      className="ml-1.5 rounded bg-slate-700/60 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase text-slate-300"
                      title="No sportsbook line; set at the player's season average"
                    >
                      Avg
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-center">
                  {(["L5", "L10", "SZN"] as WindowKey[]).map((w) => {
                    const hr = pick.windows[w];
                    return (
                      <span key={w} className="text-xs tabular-nums text-slate-300">
                        <span className="block text-[0.6rem] uppercase tracking-wider text-slate-500">{w}</span>
                        {pct(directionalRate(hr, pick.direction))}
                        <span className="block text-[0.6rem] text-slate-500">
                          {directionalHits(hr, pick.direction)}/{hr.n}
                        </span>
                      </span>
                    );
                  })}
                </div>
                <div className="text-right">
                  <p className="text-xl font-black tabular-nums text-white">{pct(pick.estimate)}</p>
                  <p className="text-[0.6rem] uppercase tracking-wider text-slate-500">Hit est.</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500">
            Suggestion from past hit rates — not a guarantee. Disagree with one? On{" "}
            <Link to="/picks" className="font-semibold text-emerald-300 hover:text-emerald-200">
              Suggested Bets
            </Link>{" "}
            you can fade it and take the other side.
          </p>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="rounded-2xl border border-slate-800 bg-slate-900/30 p-6 lg:col-span-3">
          <h2 className="mb-5 text-lg font-bold text-white">Where the gravity comes from</h2>
          <ComponentBreakdown components={player.components} total={player.gravity} />
        </section>

        <section className="space-y-3 lg:col-span-2">
          <h2 className="text-lg font-bold text-white">Per game</h2>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Games" value={String(player.games)} />
            <Stat label="Minutes" value={fmt(player.minutes)} />
            <Stat label="3PA" value={fmt(player.three_pa)} />
            <Stat label="Drives" value={fmt(player.drives)} note={player.drives_estimated ? "estimated" : undefined} />
            <Stat label="Assists" value={fmt(player.assists)} />
            <Stat label="Turnovers" value={fmt(player.turnovers)} />
          </div>
          {player.drives_estimated && (
            <p className="text-xs text-amber-400">* Drives estimated from shot attempts; NBA.com tracking data was unavailable.</p>
          )}
        </section>
      </div>

      {neighbors.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-bold text-white">Nearby in the rankings</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {neighbors.map((p) => (
              <Link
                key={p.player_id}
                to={`/players/${p.slug}${season === currentSeason() ? "" : `?season=${season}`}`}
                className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 transition-colors hover:border-slate-600"
              >
                <p className="text-xs text-slate-500">#{p.rank} · {p.team}</p>
                <p className="mt-1 font-semibold text-white">{p.player_name}</p>
                <div className="mt-3 flex items-center gap-3">
                  <StackedBar components={p.components} max={maxGravity} />
                  <span className={`text-lg font-black ${uvsTone(p.uvs)}`}>{fmt(p.uvs, 0)}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default Player;
