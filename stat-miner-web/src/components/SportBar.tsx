import React, { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { SPORTS, sportForPath } from "../lib/sports";

const SportBar: React.FC = () => {
  const { pathname } = useLocation();
  const active = sportForPath(pathname);
  const activeRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [active]);

  const item = (key: string, to: string, label: string, status?: "soon" | "demo") => {
    const isActive = active === key;
    return (
      <Link
        key={key}
        to={to}
        ref={isActive ? activeRef : undefined}
        aria-current={isActive ? "page" : undefined}
        title={status === "soon" ? "Coming soon" : status === "demo" ? "Demo data" : undefined}
        className={`flex shrink-0 items-center gap-1 whitespace-nowrap border-b-2 px-2.5 py-2 text-xs font-bold uppercase tracking-wide transition-colors ${
          isActive ? "border-emerald-400 text-white" : "border-transparent text-slate-400 hover:text-white"
        }`}
      >
        {label}
        {status === "soon" && <span className="h-1 w-1 rounded-full bg-slate-500" aria-label="coming soon" />}
        {status === "demo" && <span className="text-[0.55rem] font-semibold normal-case tracking-normal text-amber-300">demo</span>}
      </Link>
    );
  };

  return (
    <nav aria-label="Sports" className="relative border-b border-slate-800/80 bg-slate-900/70">
      <div className="mx-auto flex max-w-6xl overflow-x-auto px-2 sm:px-4 [scrollbar-width:none]">
        {SPORTS.map((s) => item(s.key, s.live ? "/" : `/sports/${s.key}`, s.label, s.live ? undefined : "soon"))}
        {item("all", "/dashboard", "All sports", "demo")}
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-slate-900 lg:hidden" aria-hidden="true" />
    </nav>
  );
};

export default SportBar;
