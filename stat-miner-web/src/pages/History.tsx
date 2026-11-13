import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Spinner } from "../components/StatusViews";
import { useDocumentTitle, usePicksHistory } from "../lib/hooks";
import type { HistoryDay, HistoryParlay, HistoryPick, PickResult, RecordAggregate } from "../lib/history";
import { TIER_ORDER, TIER_SPECS } from "../lib/picks";
import { SPORT_LABELS, STAT_BY_KEY } from "../lib/props";

const pct = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);

function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function formatShortDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function fmtActual(actual: number): string {
  return Number.isInteger(actual) ? String(actual) : actual.toFixed(1);
}

const TIER_TEXT: Record<string, string> = {
  safe: "text-emerald-300",
  moderate: "text-amber-300",
  risky: "text-rose-300",
};

const ResultBadge: React.FC<{ result: PickResult | null }> = ({ result }) => {
  if (result === null) {
    return (
      <span className="rounded bg-slate-700/60 px-1.5 py-0.5 text-[0.65rem] font-bold uppercase text-slate-300">
        Pending
      </span>
    );
  }
  const styles: Record<PickResult, string> = {
    hit: "bg-emerald-500/15 text-emerald-300",
    miss: "bg-rose-500/15 text-rose-300",
    push: "bg-amber-500/15 text-amber-300",
    void: "bg-slate-600/40 text-slate-400",
  };
  const labels: Record<PickResult, string> = { hit: "✓ Hit", miss: "✗ Miss", push: "Push", void: "Void" };
  return (
    <span className={`rounded px-1.5 py-0.5 text-[0.65rem] font-bold uppercase ${styles[result]}`}>{labels[result]}</span>
  );
};

const PickLine: React.FC<{ pick: HistoryPick }> = ({ pick }) => {
  const stat = (STAT_BY_KEY as Record<string, { label: string; name: string } | undefined>)[pick.stat];
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-semibold text-white">{pick.player}</span>
      <span
        className={`rounded px-1.5 py-0.5 text-[0.65rem] font-black uppercase ${
          pick.direction === "Over" ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"
        }`}
      >
        {pick.direction} {pick.line} {stat?.label ?? pick.stat.toUpperCase()}
      </span>
      <span className="text-xs text-slate-500">
        {pick.team} · {pick.opp} · {stat?.name ?? pick.stat}
        {pick.line_source === "avg" ? " · avg line" : ""}
      </span>
      <span className="ml-auto flex items-center gap-2">
        <span className="text-xs tabular-nums text-slate-400">est. {pct(pick.estimate)}</span>
        {pick.actual !== null && (
          <span className="text-xs tabular-nums text-slate-300">actual {fmtActual(pick.actual)}</span>
        )}
        <ResultBadge result={pick.result} />
      </span>
    </div>
  );
};

const ParlayBlock: React.FC<{ parlay: HistoryParlay }> = ({ parlay }) => (
  <article className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2.5">
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm font-semibold text-slate-200">
        {parlay.legs.length}-leg parlay · combined <span className="font-black tabular-nums text-white">~{pct(parlay.combined)}</span>
      </span>
      <ResultBadge result={parlay.result} />
    </div>
    <ul className="mt-2 space-y-1.5 border-t border-slate-800/70 pt-2">
      {parlay.legs.map((leg, i) => (
        <li key={`${leg.player}-${leg.stat}-${i}`}>
          <PickLine pick={leg} />
        </li>
      ))}
    </ul>
  </article>
);

const RecordCard: React.FC<{ title: string; titleClass?: string; agg: RecordAggregate }> = ({ title, titleClass, agg }) => (
  <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
    <p className={`text-xs font-bold uppercase tracking-widest ${titleClass ?? "text-slate-300"}`}>{title}</p>
    <p className="mt-2 text-3xl font-black tabular-nums text-white">{pct(agg.hit_rate)}</p>
    {agg.hit_rate === null ? (
      <p className="mt-1 text-xs text-slate-500">
        {agg.pending > 0 ? "First results after the games finish." : "No graded picks yet."}
      </p>
    ) : (
      <p className="mt-1 text-xs text-slate-500">hit rate · pushes &amp; voids excluded</p>
    )}
    <div className="mt-3 flex flex-wrap gap-1.5 text-[0.65rem] font-bold uppercase">
      <span className="rounded bg-slate-800 px-1.5 py-0.5 tabular-nums text-slate-300">
        {agg.hits} W – {agg.misses} L
      </span>
      {agg.pushes > 0 && (
        <span className="rounded bg-slate-800 px-1.5 py-0.5 tabular-nums text-slate-400">{agg.pushes} push{agg.pushes === 1 ? "" : "es"}</span>
      )}
      {agg.voids > 0 && (
        <span className="rounded bg-slate-800 px-1.5 py-0.5 tabular-nums text-slate-400">{agg.voids} void</span>
      )}
      {agg.pending > 0 && (
        <span className="rounded bg-slate-800 px-1.5 py-0.5 tabular-nums text-slate-400">{agg.pending} pending</span>
      )}
    </div>
  </div>
);

const DaySection: React.FC<{ day: HistoryDay; defaultOpen: boolean }> = ({ day, defaultOpen }) => {
  const pendingCount =
    day.singles.pending + TIER_ORDER.reduce((sum, t) => sum + day.parlays[t].pending, 0);
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/30 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="text-lg font-black text-white">{formatDate(day.date)}</h3>
        {day.lines_mode === "book" ? (
          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase text-emerald-300">
            Book lines
          </span>
        ) : (
          <span
            className="rounded bg-slate-700/60 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase text-slate-300"
            title="No sportsbook lines that day; lines were set at each player's season average"
          >
            Avg lines
          </span>
        )}
        <span className="text-sm tabular-nums text-slate-300">
          Singles {day.singles.hits}–{day.singles.misses}
          {day.singles.hit_rate !== null && <span className="text-slate-500"> · {pct(day.singles.hit_rate)}</span>}
        </span>
        <span className="flex flex-wrap gap-1.5">
          {TIER_ORDER.filter((t) => day.parlays[t].n + day.parlays[t].pending > 0).map((t) => (
            <span key={t} className="rounded bg-slate-800 px-1.5 py-0.5 text-[0.65rem] font-bold uppercase tabular-nums text-slate-300">
              <span className={TIER_TEXT[t]}>{TIER_SPECS[t].label}</span> {day.parlays[t].hits}–{day.parlays[t].misses}
              {day.parlays[t].pending > 0 && <span className="text-slate-500"> · {day.parlays[t].pending} pending</span>}
            </span>
          ))}
        </span>
      </div>

      <details open={defaultOpen} className="mt-3">
        <summary className="cursor-pointer text-sm font-semibold text-slate-300 hover:text-white">
          Every pick from this day
        </summary>
        <div className="mt-3 space-y-5">
          {!day.final && pendingCount > 0 && (
            <p className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2 text-sm text-slate-400">
              These picks are locked in — results land here after the final buzzer.
            </p>
          )}

          {day.detail.singles.length > 0 && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400">Singles</h4>
              <ul className="mt-2 divide-y divide-slate-800/70 rounded-xl border border-slate-800">
                {day.detail.singles.map((pick, i) => (
                  <li key={`${pick.player}-${pick.stat}-${i}`} className="px-3 py-2">
                    <PickLine pick={pick} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {TIER_ORDER.filter((t) => day.detail.parlays[t].length > 0).map((tier) => (
            <div key={tier}>
              <h4 className={`text-xs font-bold uppercase tracking-widest ${TIER_TEXT[tier]}`}>
                {TIER_SPECS[tier].label} parlays
              </h4>
              <div className="mt-2 grid gap-3 lg:grid-cols-2">
                {day.detail.parlays[tier].map((parlay) => (
                  <ParlayBlock key={parlay.id} parlay={parlay} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
};

const WarmingUp: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <section className="rounded-2xl border border-slate-800 p-8 text-center">
    <p className="font-semibold text-slate-200">Track record is warming up — our first graded results post after tonight&apos;s games.</p>
    <p className="mx-auto mt-2 max-w-xl text-sm text-slate-400">{message}</p>
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-800"
      >
        Try again
      </button>
    )}
    <p className="mt-4 text-sm">
      <Link to="/picks" className="font-semibold text-emerald-300 hover:text-emerald-200">
        See today&apos;s suggested bets →
      </Link>
    </p>
  </section>
);

const History: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const sport = params.get("sport") === "nfl" ? "nfl" : "nba";
  useDocumentTitle("Track record");
  const { data, error, loading, retry } = usePicksHistory(sport);
  const sportLabel = SPORT_LABELS[sport] ?? "NBA";

  // Days arrive oldest-first; show newest first, and skip days where no
  // picks were published at all (e.g. an off-day snapshot).
  const trackedDays = data
    ? data.days
        .filter(
          (day) =>
            day.detail.singles.length > 0 || TIER_ORDER.some((t) => day.detail.parlays[t].length > 0),
        )
        .slice()
        .reverse()
    : [];

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white">Our track record</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-400">
            Every pick we publish is locked in before the games and graded after — nothing edited, nothing deleted.
            {data?.since && (
              <>
                {" "}
                Tracking since {formatShortDate(data.since)}.
              </>
            )}
          </p>
        </div>

        <div className="flex gap-1 self-start rounded-2xl border border-slate-800 bg-slate-900/60 p-1">
          {(["nba", "nfl"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setParams(new URLSearchParams({ sport: s }), { replace: true })}
              className={`rounded-xl px-3 py-1 text-xs font-bold transition-colors ${
                sport === s ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              {SPORT_LABELS[s]}
            </button>
          ))}
        </div>
      </header>

      {loading && !data ? (
        <Spinner label="Loading the track record…" />
      ) : error || !data ? (
        <WarmingUp
          message={`The ${sportLabel} record isn't available just yet. Every pick is snapshotted before the games and graded once they're final, so check back after the slate wraps up.`}
          onRetry={retry}
        />
      ) : trackedDays.length === 0 ? (
        <WarmingUp
          message={`No ${sportLabel} picks are on the record yet. The record starts with the first slate we publish — tonight's picks will appear here locked in, then graded after the games.`}
        />
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <RecordCard title="Singles" agg={data.totals.singles} />
            {TIER_ORDER.map((tier) => (
              <RecordCard
                key={tier}
                title={`${TIER_SPECS[tier].label} parlays`}
                titleClass={TIER_TEXT[tier]}
                agg={data.totals.parlays[tier]}
              />
            ))}
          </section>

          <section className="space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-widest text-emerald-300">Day by day</h2>
            {trackedDays.map((day, i) => (
              <DaySection key={day.date} day={day} defaultOpen={i === 0} />
            ))}
          </section>

          <details className="rounded-2xl border border-slate-800 bg-slate-900/30 p-4 text-sm text-slate-400">
            <summary className="cursor-pointer font-semibold text-slate-200">How grading works</summary>
            <div className="mt-3 space-y-2">
              <p>
                Before each slate, the day&apos;s suggested bets and parlays are saved exactly as published and never
                changed. After the games, every pick is checked against what the player actually did:{" "}
                <span className="font-semibold text-slate-200">hit</span> or{" "}
                <span className="font-semibold text-slate-200">miss</span> against the line.
              </p>
              <p>
                A pick that lands exactly on the line is a <span className="font-semibold text-slate-200">push</span>,
                and a player who didn&apos;t play makes the pick{" "}
                <span className="font-semibold text-slate-200">void</span> — neither counts for or against the hit
                rate. A parlay misses if any leg misses; push and void legs drop out, and the parlay hits if every
                remaining leg hits.
              </p>
              <p>Days marked &ldquo;Avg lines&rdquo; used each player&apos;s season average as the line because sportsbooks hadn&apos;t posted one yet — the picks are graded against that same published line, and the day is labelled so you can weigh it yourself.</p>
            </div>
          </details>
        </>
      )}

      <footer className="border-t border-slate-800 pt-4 text-center text-xs leading-relaxed text-slate-500">
        <p className="font-semibold text-slate-400">21+. Bet responsibly. If gambling stops being fun, call 1-800-GAMBLER.</p>
        <p className="mt-1">Suggestions only — Gravity Score does not take bets and cannot promise any outcome.</p>
      </footer>
    </div>
  );
};

export default History;
