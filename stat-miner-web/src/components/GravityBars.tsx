import React from "react";
import type { GravityComponents } from "../lib/api";
import { fmt } from "../lib/format";

export const COMPONENT_INFO: Record<keyof GravityComponents, { label: string; color: string; blurb: string }> = {
  spacing: {
    label: "Spacing",
    color: "bg-sky-400",
    blurb: "3-point attempts × 1.5. Volume shooters drag defenders out to the arc.",
  },
  rim_pressure: {
    label: "Rim pressure",
    color: "bg-emerald-400",
    blurb: "Drives × 1.2. Every drive forces help defense to collapse.",
  },
  playmaking: {
    label: "Playmaking",
    color: "bg-violet-400",
    blurb: "Assists × 2 ÷ (turnovers + 1). Creating for others without giving it away.",
  },
};

const ORDER: (keyof GravityComponents)[] = ["spacing", "rim_pressure", "playmaking"];

export const StackedBar: React.FC<{ components: GravityComponents; max: number }> = ({ components, max }) => (
  <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-800" aria-hidden="true">
    {ORDER.map((key) => (
      <div
        key={key}
        className={COMPONENT_INFO[key].color}
        style={{ width: `${(100 * components[key]) / Math.max(max, 1)}%` }}
      />
    ))}
  </div>
);

export const ComponentLegend: React.FC = () => (
  <div className="flex flex-wrap gap-4 text-xs text-slate-400">
    {ORDER.map((key) => (
      <span key={key} className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${COMPONENT_INFO[key].color}`} />
        {COMPONENT_INFO[key].label}
      </span>
    ))}
  </div>
);

export const ComponentBreakdown: React.FC<{ components: GravityComponents; total: number }> = ({ components, total }) => (
  <div className="space-y-4">
    {ORDER.map((key) => {
      const value = components[key];
      const share = total > 0 ? (100 * value) / total : 0;
      return (
        <div key={key}>
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span className="font-semibold text-slate-200">{COMPONENT_INFO[key].label}</span>
            <span className="text-slate-400">
              <span className="font-semibold text-white">{fmt(value)}</span> pts · {fmt(share, 0)}%
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-800">
            <div className={`h-full rounded-full ${COMPONENT_INFO[key].color}`} style={{ width: `${share}%` }} />
          </div>
          <p className="mt-1 text-xs text-slate-500">{COMPONENT_INFO[key].blurb}</p>
        </div>
      );
    })}
  </div>
);
