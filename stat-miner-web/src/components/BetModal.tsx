import React, { useEffect } from "react";
import {
  americanOdds,
  BOOK_NAMES,
  kalshiFor,
  STAT_BY_KEY,
  type BookOffer,
  type KalshiMarket,
  type Side,
  type StatKey,
} from "../lib/props";
import type { TrackedLeg } from "../lib/tracker";
import LogBetForm from "./LogBetForm";

export type BetTarget = {
  name: string;
  stat: StatKey;
  line: number;
  offers: BookOffer[];
  kalshi: KalshiMarket[];
  /** Details for logging the bet to the tracker. */
  leg: TrackedLeg;
};

const cents = (p: number | null) => (p === null ? "—" : `${Math.round(p * 100)}¢`);

const ExternalLink: React.FC<{ href: string; className: string; children: React.ReactNode }> = ({ href, className, children }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
    {children}
  </a>
);

const BetModal: React.FC<{ target: BetTarget; onClose: () => void }> = ({ target, onClose }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const stat = STAT_BY_KEY[target.stat];
  const exact = kalshiFor(target.kalshi, target.line);
  const nearby = exact
    ? []
    : [...target.kalshi].sort((a, b) => Math.abs(a.strike - target.line) - Math.abs(b.strike - target.line)).slice(0, 3)
        .sort((a, b) => a.strike - b.strike);

  const books = Object.entries(
    target.offers.reduce<Record<string, BookOffer[]>>((acc, o) => {
      (acc[o.book] ??= []).push(o);
      return acc;
    }, {}),
  );

  const btn = "rounded-lg border px-3 py-2 text-sm font-semibold transition-colors";

  const suggest = (book: string, side: Side): number | null => {
    if (book === "Kalshi") {
      const price = side === "Over" ? exact?.yes_ask : exact?.no_ask;
      return price ? Math.round(price * 100) : null;
    }
    const key = Object.entries(BOOK_NAMES).find(([, name]) => name === book)?.[0];
    const offer = target.offers.find((o) => o.book === key && o.side === side && o.point === target.line);
    return offer?.price ?? null;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Bet ${target.name} ${stat.label}`}
        className="max-h-[90vh] w-full max-w-md space-y-5 overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-slate-500">Bet this prop</p>
            <h2 className="text-lg font-bold text-white">
              {target.name} · {stat.name} {target.line}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-xl leading-none text-slate-400 hover:text-white">
            ×
          </button>
        </div>

        <section className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Kalshi</h3>
          {exact ? (
            <div className="grid grid-cols-2 gap-2">
              <ExternalLink href={exact.url} className={`${btn} border-emerald-600 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20`}>
                Over {target.line}
                <span className="block text-xs font-normal text-emerald-300/80">Buy Yes {cents(exact.yes_ask)}</span>
              </ExternalLink>
              <ExternalLink href={exact.url} className={`${btn} border-rose-700 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20`}>
                Under {target.line}
                <span className="block text-xs font-normal text-rose-300/80">Buy No {cents(exact.no_ask)}</span>
              </ExternalLink>
            </div>
          ) : nearby.length ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-400">Kalshi doesn&apos;t list {target.line} exactly. Nearest lines:</p>
              <div className="flex flex-wrap gap-2">
                {nearby.map((m) => (
                  <ExternalLink key={m.strike} href={m.url} className={`${btn} border-slate-600 text-slate-200 hover:bg-slate-800`}>
                    {Math.ceil(m.strike)}+ <span className="text-xs font-normal text-slate-400">Yes {cents(m.yes_ask)}</span>
                  </ExternalLink>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">No Kalshi market for this prop right now.</p>
          )}
          <p className="text-[0.7rem] text-slate-500">Price in cents is roughly the market&apos;s chance (54¢ ≈ 54%).</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Sportsbooks</h3>
          {books.length ? (
            <div className="space-y-2">
              {books.map(([book, offers]) => (
                <div key={book} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 text-sm font-semibold text-slate-200">{BOOK_NAMES[book] ?? book}</span>
                  {(["Over", "Under"] as const).map((side) => {
                    const o = offers.find((x) => x.side === side);
                    return o ? (
                      <ExternalLink key={side} href={o.link} className={`${btn} flex-1 border-slate-600 py-1.5 text-center text-slate-200 hover:bg-slate-800`}>
                        {side === "Over" ? "O" : "U"} {o.point} <span className="font-normal text-slate-400">{americanOdds(o.price)}</span>
                      </ExternalLink>
                    ) : (
                      <span key={side} className="flex-1" />
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No sportsbook bet-slip links loaded for this prop today.</p>
          )}
        </section>

        <section className="space-y-2 border-t border-slate-800 pt-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Placed it? Log it</h3>
          <LogBetForm legs={[{ ...target.leg, line: target.line }]} suggest={suggest} single />
        </section>

        <p className="border-t border-slate-800 pt-3 text-[0.7rem] text-slate-500">
          Links open the provider&apos;s site; availability depends on your state. Gravity Score doesn&apos;t take bets or earn
          from them. 21+ (18+ where permitted). Gambling problem? Call 1-800-GAMBLER.
        </p>
      </div>
    </div>
  );
};

export default BetModal;
