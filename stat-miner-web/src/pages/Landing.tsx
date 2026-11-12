import React from "react";
import { Link } from "react-router-dom";
import PlayerSearch from "../components/PlayerSearch";
import { ComponentLegend, COMPONENT_INFO, StackedBar } from "../components/GravityBars";
import { DataSourceNote, Spinner } from "../components/StatusViews";
import { useDocumentTitle, useLeaderboard } from "../lib/hooks";
import { currentSeason, fmt, uvsTone } from "../lib/format";

const Landing: React.FC = () => {
  useDocumentTitle("");
  const { data, loading, error } = useLeaderboard(currentSeason());
  const top = data?.players.slice(0, 5) ?? [];
  const maxGravity = top[0]?.gravity ?? 1;

  return (
    <div className="space-y-20">
      <section className="relative overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-950 to-emerald-950/40 px-6 py-16 sm:px-12">
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full border border-teal-400/10" />
        <div className="pointer-events-none absolute -right-10 -top-10 h-52 w-52 rounded-full border border-teal-400/20" />
        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.25em] text-emerald-400">
          NBA · {currentSeason()} season
        </p>
        <h1 className="max-w-3xl text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl">
          How hard does a player bend the defense?
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-slate-400">
          Gravity Score measures the pull a player puts on opponents: the shooting that drags defenders
          to the arc, the drives that collapse help, and the passing that punishes it. One number, every
          player, updated from NBA.com.
        </p>
        <div className="mt-8 max-w-xl">
          <PlayerSearch size="lg" />
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            to="/leaderboard"
            className="rounded-full bg-emerald-500 px-5 py-2.5 text-sm font-bold text-slate-950 transition-colors hover:bg-emerald-400"
          >
            See the leaderboard
          </Link>
          <Link
            to="/how-it-works"
            className="rounded-full border border-slate-700 px-5 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800"
          >
            How it works
          </Link>
        </div>
      </section>

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
