import React, { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { sportForPath } from "../lib/sports";
import Logo from "./Logo";
import PlayerSearch from "./PlayerSearch";
import SportBar from "./SportBar";

const NBA_NAV = [
  { to: "/leaderboard", label: "Leaderboard" },
  { to: "/props", label: "Props" },
  { to: "/tracker", label: "Tracker" },
  { to: "/how-it-works", label: "How it works" },
];

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
    isActive ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white"
  }`;

const Layout: React.FC = () => {
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const isNba = sportForPath(pathname) === "nba";
  const nav = isNba ? NBA_NAV : [];

  useEffect(() => {
    window.scrollTo(0, 0);
    setMenuOpen(false);
  }, [pathname]);

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 font-sans text-slate-200">
      <header className="sticky top-0 z-20 border-b border-slate-800/80 bg-slate-950/85 backdrop-blur">
        <SportBar />
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link to="/" aria-label="Gravity Score home" className="shrink-0">
            <Logo />
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {nav.map((item) => (
              <NavLink key={item.to} to={item.to} className={navClass}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          {isNba && (
            <div className="ml-auto hidden w-64 md:block">
              <PlayerSearch />
            </div>
          )}

          <button
            type="button"
            className={`ml-auto rounded-lg border border-slate-700 p-2 text-slate-300 md:hidden ${isNba ? "" : "hidden"}`}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor" aria-hidden="true">
              {menuOpen ? (
                <path d="M5.3 4.3a1 1 0 0 0-1.4 1.4L8.6 10l-4.7 4.3a1 1 0 1 0 1.4 1.4L10 11.4l4.3 4.3a1 1 0 0 0 1.4-1.4L11.4 10l4.3-4.3a1 1 0 0 0-1.4-1.4L10 8.6 5.3 4.3Z" />
              ) : (
                <path d="M3 5h14a1 1 0 1 0 0-2H3a1 1 0 0 0 0 2Zm14 4H3a1 1 0 0 0 0 2h14a1 1 0 1 0 0-2Zm0 6H3a1 1 0 0 0 0 2h14a1 1 0 1 0 0-2Z" />
              )}
            </svg>
          </button>
        </div>

        {menuOpen && (
          <div className="space-y-3 border-t border-slate-800 px-4 pb-4 pt-3 md:hidden">
            <PlayerSearch onNavigate={() => setMenuOpen(false)} />
            {nav.length > 0 && (
              <nav className="flex flex-col gap-1" aria-label="Mobile">
                {nav.map((item) => (
                  <NavLink key={item.to} to={item.to} className={navClass}>
                    {item.label}
                  </NavLink>
                ))}
              </nav>
            )}
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <Outlet />
      </main>

      <footer className="border-t border-slate-800/80">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>© {new Date().getFullYear()} Gravity Score. NBA stats from NBA.com and ESPN. Not affiliated with any league.</p>
          <p>For entertainment and analysis only. Not betting advice.</p>
        </div>
      </footer>
    </div>
  );
};

export default Layout;
