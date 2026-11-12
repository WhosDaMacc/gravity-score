import React from "react";

export type StatValue = string | number | boolean;

export const HIDDEN_STAT_KEYS = new Set(["gravity_formula", "data_source", "drives_estimated"]);

export const DataQualityNotice: React.FC<{ stats: Record<string, StatValue> }> = ({ stats }) => {
  const notes: string[] = [];
  if (stats.data_source === "mock") {
    notes.push("Demo data: live NBA stats are unavailable.");
  }
  if (stats.drives_estimated === true) {
    notes.push("Drives estimated from shot attempts (tracking data unavailable).");
  }
  if (notes.length === 0) return null;
  return <p className="text-[0.7rem] text-amber-400">{notes.join(" ")}</p>;
};

type SportTileProps = {
  sport: string;
  player?: string;
  uvs: number;
  edgeAlert: boolean;
  rank?: number;
  demo?: boolean;
  details: {
    matchup: string;
    stats: Record<string, StatValue>;
  };
  link?: string;
  isInPhantom?: boolean;
  onTogglePhantom?: () => void;
};

const STAT_EXPLANATIONS: Record<string, string> = {
  "3PA": "3-Point Attempts – per game, part of Gravity formula.",
  Drives: "Drives – drives to the basket per game.",
  Ast: "Assists – per game.",
  TOV: "Turnovers – per game.",
  impact_score: "Raw model score before scaling to 0–100.",
  StrAcc: "Strike Accuracy – % of significant strikes that land.",
  TDDef: "Takedown Defense – % of opponent takedowns successfully defended.",
  Gravity: "Gravity – how much a player bends the defense / creates spacing.",
  xA: "Expected Assists – quality of chances created for teammates.",
  Speed: "Speed Figure – pace-adjusted performance rating for this runner.",
  Track: "Track Condition – surface/ground rating (e.g. Fast/Soft).",
  Tires: "Tire Compound – affects grip, degradation and race pace.",
  Lap: "Race Progress – current lap out of total distance.",
};

const SportTile: React.FC<SportTileProps> = ({
  sport,
  player,
  uvs,
  edgeAlert,
  rank,
  demo,
  details,
  link,
  isInPhantom,
  onTogglePhantom,
}) => {
  const intensity =
    uvs >= 85 ? "from-green-500/40 to-emerald-700/10" : uvs >= 60
      ? "from-sky-500/30 to-slate-800/40"
      : "from-slate-700/40 to-slate-900/60";

  const borderColor = edgeAlert ? "border-green-500/70" : "border-slate-700";

  return (
    <div
      className={`relative flex flex-col rounded-2xl border ${borderColor} bg-gradient-to-br ${intensity} p-4 shadow-lg shadow-black/40`}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-400">
          {sport}
          {demo && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[0.6rem] font-bold tracking-wider text-amber-300">
              Demo data
            </span>
          )}
        </span>
        {edgeAlert && (
          <span className="rounded-full bg-green-500/15 px-3 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-green-400">
            Edge Alert
          </span>
        )}
      </div>

      <div className="mb-3">
        <p className="text-sm text-slate-400">{player ? "Player / Matchup" : "Matchup"}</p>
        <p className="text-base font-semibold text-slate-50">
          {player ? `${player} — ${details.matchup}` : details.matchup}
        </p>
      </div>

      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
            Unified Value Score
          </p>
          <p className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-white">
              {Math.round(uvs)}
              <span className="ml-1 text-sm font-semibold text-slate-500">
                /100
              </span>
            </span>
            {rank != null && (
              <span className="rounded bg-slate-700/80 px-2 py-0.5 text-xs font-bold text-slate-200">
                #{rank}
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="mt-auto space-y-3">
        <DataQualityNotice stats={details.stats} />
        <div className="grid grid-cols-2 gap-2 text-xs text-slate-300">
          {Object.entries(details.stats)
            .filter(([label]) => !HIDDEN_STAT_KEYS.has(label))
            .map(([label, value]) => {
            const explanation = STAT_EXPLANATIONS[label] ?? "Key stat for this matchup.";

            return (
              <div
                key={label}
                className="rounded-lg border border-slate-700/70 bg-slate-900/50 px-2 py-1"
              >
                <p className="break-words text-[0.65rem] uppercase tracking-[0.12em] text-slate-500">
                  {label.replace(/_/g, " ")}
                </p>
                <p className="font-semibold text-slate-100">
                  {typeof value === "number" ? String(Math.round(value * 100) / 100) : String(value)}
                </p>
                <p className="mt-1 text-[0.65rem] leading-snug text-slate-500">
                  {explanation}
                </p>
              </div>
            );
          })}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex flex-1 items-center justify-center rounded-xl border border-emerald-500/70 bg-emerald-500/15 px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-emerald-300 transition-colors hover:bg-emerald-500/25"
            >
              View Odds / Place Bet
            </a>
          )}

          {onTogglePhantom && (
            <button
              type="button"
              onClick={onTogglePhantom}
              className={`inline-flex flex-1 items-center justify-center rounded-xl border px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.18em] transition-colors ${
                isInPhantom
                  ? "border-violet-400 bg-violet-500/20 text-violet-200 hover:bg-violet-500/30"
                  : "border-slate-600 bg-slate-900/60 text-slate-200 hover:bg-slate-800"
              }`}
            >
              {isInPhantom ? "Remove from Phantom Parlay" : "Add to Phantom Parlay"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default SportTile;

