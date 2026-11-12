import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLeaderboard } from "../lib/hooks";
import { currentSeason, slugify } from "../lib/format";

type Props = { autoFocus?: boolean; size?: "sm" | "lg"; onNavigate?: () => void };

const PlayerSearch: React.FC<Props> = ({ autoFocus, size = "sm", onNavigate }) => {
  const navigate = useNavigate();
  const { data } = useLeaderboard(currentSeason());
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const matches = useMemo(() => {
    const q = slugify(query);
    if (!q || !data) return [];
    return data.players.filter((p) => p.slug.includes(q)).slice(0, 6);
  }, [query, data]);

  const go = (slug: string) => {
    setQuery("");
    setOpen(false);
    onNavigate?.();
    navigate(`/players/${slug}`);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const pick = matches[active] ?? matches[0];
    const slug = pick ? pick.slug : slugify(query);
    if (slug) go(slug);
  };

  const big = size === "lg";

  return (
    <form onSubmit={submit} className="relative w-full" role="search">
      <input
        type="search"
        aria-label="Search NBA players"
        autoFocus={autoFocus}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="Search any NBA player…"
        className={`w-full rounded-full border border-slate-700 bg-slate-900/80 text-slate-100 placeholder-slate-500 outline-none transition-colors focus:border-emerald-500 ${
          big ? "px-6 py-3.5 text-base" : "px-4 py-1.5 text-sm"
        }`}
      />
      {open && matches.length > 0 && (
        <ul className="absolute left-0 right-0 z-30 mt-2 overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-xl shadow-black/50">
          {matches.map((p, i) => (
            <li key={p.player_id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => go(p.slug)}
                className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm ${
                  i === active ? "bg-slate-800 text-white" : "text-slate-300 hover:bg-slate-800/60"
                }`}
              >
                <span>
                  {p.player_name} <span className="text-slate-500">{p.team}</span>
                </span>
                <span className="font-semibold text-emerald-300">#{p.rank}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
};

export default PlayerSearch;
