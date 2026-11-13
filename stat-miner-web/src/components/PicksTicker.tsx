import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { usePropsBoard } from "../lib/hooks";
import { buildPicks, directionalHits, type Pick } from "../lib/picks";

const MAX_ITEMS = 10;

function tickerText(pick: Pick): string {
  const pct = Math.round(pick.estimate * 100);
  const l10 = pick.windows.L10;
  const hits = directionalHits(l10, pick.direction);
  const unit = pick.direction === "Over" ? "overs" : "unders";
  return `${pick.playerName} ${pick.direction} ${pick.line} ${pick.statLabel} · cleared ${pct}% · L10 ${hits}/${l10.n} ${unit}`;
}

/**
 * Slim scrolling strip of the top suggested singles, fed by the picks engine
 * from the NBA board (and the NFL board when it has games today). Renders
 * nothing when neither board yields a suggestion — no empty strip, no filler.
 */
const PicksTicker: React.FC = () => {
  const nba = usePropsBoard("nba");
  const nfl = usePropsBoard("nfl");

  const items = useMemo(() => {
    const picks: Pick[] = [];
    for (const board of [nba.data, nfl.data]) {
      if (board && board.games.length) picks.push(...buildPicks(board).singles);
    }
    return picks
      .sort((a, b) => b.estimate - a.estimate)
      .slice(0, MAX_ITEMS)
      .map(tickerText);
  }, [nba.data, nfl.data]);

  if (!items.length) return null;

  const doubled = [...items, ...items];
  return (
    <div className="flex items-stretch border-t border-slate-800/80 bg-emerald-950/40" aria-label="Top suggested bets">
      <Link
        to="/picks"
        className="flex shrink-0 items-center bg-emerald-500/15 px-3 py-1.5 text-[0.65rem] font-black uppercase tracking-widest text-emerald-300 hover:text-emerald-200"
      >
        Picks
      </Link>
      <div className="picks-ticker-viewport relative flex-1 overflow-hidden">
        <div
          className="picks-ticker-track flex w-max items-center gap-10 py-1.5 pl-6"
          style={{ animationDuration: `${Math.max(24, items.length * 6)}s` }}
        >
          {doubled.map((text, i) => (
            <Link
              key={i}
              to="/picks"
              aria-hidden={i >= items.length}
              tabIndex={i >= items.length ? -1 : undefined}
              className="whitespace-nowrap text-xs font-medium text-slate-300 hover:text-white"
            >
              {text}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PicksTicker;
