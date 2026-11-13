import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { type Side } from "../lib/props";
import { BOOK_OPTIONS, kalshiCentsToAmerican, tracker, type TrackedLeg } from "../lib/tracker";

const LAST_STAKE_KEY = "gravityscore.lastStake";

type Props = {
  legs: TrackedLeg[];
  /** Suggested price for a book and side: American odds, or cents for Kalshi. */
  suggest?: (book: string, side: Side) => number | null;
  /** Singles can switch Over/Under in the form; parlays keep each leg's side. */
  single?: boolean;
};

const LogBetForm: React.FC<Props> = ({ legs, suggest, single }) => {
  const [book, setBook] = useState("Kalshi");
  const [side, setSide] = useState<Side>(legs[0]?.side ?? "Over");
  const [price, setPrice] = useState("");
  const [stake, setStake] = useState(() => localStorage.getItem(LAST_STAKE_KEY) ?? "10");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const isKalshi = book === "Kalshi";
  const suggestRef = useRef(suggest);
  suggestRef.current = suggest;

  useEffect(() => {
    const s = suggestRef.current?.(book, side);
    setPrice(s === null || s === undefined ? "" : String(s));
  }, [book, side]);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const stakeNum = Number(stake);
    const priceNum = Number(price.replace(/[¢\s]/g, ""));
    if (!(stakeNum > 0)) return setError("Enter a stake above 0.");
    if (isKalshi ? !(priceNum >= 1 && priceNum <= 99) : !(Math.abs(priceNum) >= 100)) {
      return setError(isKalshi ? "Kalshi price is 1–99 cents." : "Odds look like -110 or +150.");
    }
    tracker.add({
      book,
      stake: stakeNum,
      odds: isKalshi ? kalshiCentsToAmerican(priceNum) : Math.round(priceNum),
      legs: single ? legs.map((l) => ({ ...l, side })) : legs,
    });
    localStorage.setItem(LAST_STAKE_KEY, String(stakeNum));
    setError(null);
    setSaved(true);
  };

  if (saved) {
    return (
      <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
        Logged to your tracker. <Link to="/tracker" className="font-semibold underline hover:text-white">View tracker</Link>
      </p>
    );
  }

  const field = "rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white outline-none focus:border-emerald-500";

  return (
    <form onSubmit={save} className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        {single && (
          <div className="inline-flex overflow-hidden rounded-md border border-slate-700 text-xs font-bold">
            {(["Over", "Under"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSide(s)}
                className={`px-2.5 py-2 ${side === s ? (s === "Over" ? "bg-emerald-600 text-white" : "bg-rose-600 text-white") : "text-slate-400 hover:text-white"}`}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <label className="text-[0.65rem] uppercase tracking-wider text-slate-500">
          Book
          <select value={book} onChange={(e) => setBook(e.target.value)} className={`${field} mt-0.5 block`}>
            {BOOK_OPTIONS.map((b) => <option key={b}>{b}</option>)}
          </select>
        </label>
        <label className="text-[0.65rem] uppercase tracking-wider text-slate-500">
          {isKalshi ? "Price (¢)" : "Odds"}
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="numeric"
            placeholder={isKalshi ? "54" : "-110"}
            className={`${field} mt-0.5 block w-20`}
          />
        </label>
        <label className="text-[0.65rem] uppercase tracking-wider text-slate-500">
          Stake ($)
          <input value={stake} onChange={(e) => setStake(e.target.value)} inputMode="decimal" className={`${field} mt-0.5 block w-20`} />
        </label>
        <button type="submit" className="rounded-md bg-violet-600 px-3 py-2 text-sm font-bold text-white hover:bg-violet-500">
          Log bet
        </button>
      </div>
      {error && <p className="text-xs text-rose-300">{error}</p>}
    </form>
  );
};

export default LogBetForm;
