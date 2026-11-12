import React, { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import SportTile, { type StatValue } from "../components/SportTile";
import { getJson } from "../lib/api";
import { useDocumentTitle } from "../lib/hooks";
import { SPORT_BY_KEY } from "../lib/sports";
import NotFound from "./NotFound";

type DemoTile = {
  id: number;
  sport: string;
  player: string;
  uvs: number;
  edgeAlert: boolean;
  details: { matchup: string; stats: Record<string, StatValue> };
};

const SportHub: React.FC = () => {
  const { sport: key = "" } = useParams();
  const sport = SPORT_BY_KEY[key];
  useDocumentTitle(sport ? `${sport.name} (coming soon)` : "Page not found");
  const [tiles, setTiles] = useState<DemoTile[]>([]);

  useEffect(() => {
    setTiles([]);
    if (!sport?.demoTiles) return;
    let alive = true;
    getJson<DemoTile[]>("/dashboard/edges")
      .then((all) => alive && setTiles(all.filter((t) => t.sport === sport.demoTiles)))
      .catch(() => alive && setTiles([]));
    return () => {
      alive = false;
    };
  }, [sport]);

  if (!sport) return <NotFound />;
  if (sport.live) return <Navigate to="/" replace />;

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 px-6 py-12 sm:px-10">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-amber-300">Coming soon</p>
        <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">{sport.name} on Gravity Score</h1>
        <p className="mt-4 max-w-2xl text-slate-400">
          In the works: {sport.plan.charAt(0).toLowerCase() + sport.plan.slice(1)} Until it&apos;s ready, NBA is fully
          live with the Gravity leaderboard and the props heat map.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/props" className="rounded-full bg-emerald-500 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-400">
            NBA props heat map
          </Link>
          <Link to="/leaderboard" className="rounded-full border border-slate-700 px-5 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-800">
            NBA leaderboard
          </Link>
        </div>
      </section>

      {tiles.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-bold text-white">Preview</h2>
            <p className="text-sm text-slate-500">Demo data from the prototype model; not real projections.</p>
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {tiles.map((t) => (
              <SportTile key={t.id} {...t} demo />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default SportHub;
