import React from "react";
import type { ApiError, BoardMeta } from "../lib/api";
import { formatAsOf } from "../lib/format";

export const Spinner: React.FC<{ label?: string }> = ({ label = "Loading…" }) => (
  <div className="flex items-center justify-center gap-3 py-16 text-sm text-slate-400" role="status">
    <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-emerald-400" />
    {label}
  </div>
);

export const ErrorState: React.FC<{ error: ApiError; onRetry?: () => void }> = ({ error, onRetry }) => (
  <div className="rounded-2xl border border-rose-900/60 bg-rose-950/30 p-6 text-center">
    <p className="text-sm text-rose-200">{error.message}</p>
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-full border border-rose-700 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-rose-200 hover:bg-rose-900/40"
      >
        Try again
      </button>
    )}
  </div>
);

export const DataSourceNote: React.FC<{ meta: BoardMeta }> = ({ meta }) => (
  <p className="text-xs text-slate-500">
    {meta.season} regular season · per-game stats from NBA.com ·{" "}
    {meta.source === "snapshot" ? (
      <span className="text-amber-400">snapshot from {formatAsOf(meta.as_of)} (live feed unavailable)</span>
    ) : (
      <>updated {formatAsOf(meta.as_of)}</>
    )}
  </p>
);
