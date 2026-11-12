import React from "react";
import { Link } from "react-router-dom";
import { COMPONENT_INFO } from "../components/GravityBars";
import { useDocumentTitle } from "../lib/hooks";

const HowItWorks: React.FC = () => {
  useDocumentTitle("How Gravity Score works");

  return (
    <article className="mx-auto max-w-3xl space-y-10">
      <header>
        <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">How Gravity Score works</h1>
        <p className="mt-4 text-lg text-slate-400">
          Some players change a defense just by being on the floor. Gravity Score puts a number on that pull
          using three things defenses have to respect.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-400">The formula</h2>
        <p className="font-mono text-lg text-white">
          (3PA × 1.5) + (Drives × 1.2) + (Assists × 2) ÷ (Turnovers + 1)
        </p>
        <p className="mt-3 text-sm text-slate-400">All inputs are per-game averages for the regular season.</p>
      </section>

      <section className="space-y-4">
        {(Object.keys(COMPONENT_INFO) as (keyof typeof COMPONENT_INFO)[]).map((key) => (
          <div key={key} className="flex gap-4">
            <span className={`mt-2 h-3 w-3 shrink-0 rounded-full ${COMPONENT_INFO[key].color}`} />
            <div>
              <h3 className="font-bold text-white">{COMPONENT_INFO[key].label}</h3>
              <p className="text-slate-400">{COMPONENT_INFO[key].blurb}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold text-white">The 0–100 score</h2>
        <p className="text-slate-400">
          The raw formula is mapped onto a 0–100 scale: a raw score of 5 or below is 0, and 50 or above is 100.
          In practice the league&apos;s heaviest creators land in the 75–90 range, and a typical rotation player
          (20+ minutes a game) scores around 30. Usually only 10 or so players reach 65 or higher, which marks elite gravity.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold text-white">Where the data comes from</h2>
        <p className="text-slate-400">
          Shooting, passing and turnover numbers come from NBA.com league leaders; drives come from NBA.com
          player tracking. Stats refresh hourly. If the live feed is unavailable we show the most recent saved
          snapshot and say so on the page. If tracking data is missing for a player, drives are estimated from
          shot attempts and marked with an asterisk.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold text-white">What it doesn&apos;t capture</h2>
        <p className="text-slate-400">
          Gravity measures volume and threat, not efficiency or defense. Off-ball screening, post-ups and cutting
          aren&apos;t in the formula, and early-season numbers move a lot on small samples.
        </p>
      </section>

      <Link
        to="/leaderboard"
        className="inline-block rounded-full bg-emerald-500 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-400"
      >
        Explore the leaderboard
      </Link>
    </article>
  );
};

export default HowItWorks;
