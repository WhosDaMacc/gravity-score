import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import SportTile, { type StatValue } from "../components/SportTile";
import { API_BASE } from "../lib/api";
import { useDocumentTitle } from "../lib/hooks";

const Dashboard: React.FC = () => {
  useDocumentTitle("Multi-sport value dashboard (demo)");

  type Tile = {
    id: number;
    sport: string;
    player: string;
    uvs: number;
    edgeAlert: boolean;
    details: {
      matchup: string;
      stats: Record<string, StatValue>;
    };
    link?: string;
  };

  type BookQuote = {
    book: string;
    price: number;
    implied_prob: number;
  };

  type BookEdge = {
    league: string;
    market: string;
    team_or_player: string;
    matchup: string;
    model_prob: number;
    edge: number;
    best_book: BookQuote;
    other_books: BookQuote[];
  };

  const ALL_SPORTS = [
    "NBA",
    "NFL",
    "NHL",
    "MLB",
    "Soccer",
    "UFC",
    "Boxing",
    "Golf",
    "F1",
    "NASCAR",
    "Horse Racing",
    "Greyhound Racing",
    "NCAA",
  ];

  const [heatmapData, setHeatmapData] = useState<Tile[]>([]);
  const hotBets: Tile[] = heatmapData.filter((t) => t.uvs >= 80);
  const liveBets: Tile[] = heatmapData.filter((t) => t.uvs >= 60);

  const sportOptions = ALL_SPORTS;

  type PastBet = {
    id: number;
    sport: string;
    player: string;
    result: "win" | "loss";
    uvsAtBet: number;
    winProb: number; // model probability at time of bet (0–1)
    date: string;
  };

  const [pastBets, setPastBets] = useState<PastBet[]>([]);
  const totalTracked = pastBets.length;
  const wins = pastBets.filter((b) => b.result === "win").length;
  const losses = pastBets.filter((b) => b.result === "loss").length;
  const winRate = totalTracked > 0 ? (wins / totalTracked) * 100 : 0;

  const [phantomParlayIds, setPhantomParlayIds] = useState<number[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const togglePhantomParlayLeg = (id: number) => {
    setPhantomParlayIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  };

  const phantomParlayLegs: Tile[] = heatmapData.filter((t) =>
    phantomParlayIds.includes(t.id),
  );

  const estimateWinProbFromUvs = (uvs: number): number => {
    // Rough heuristic: center at 55%, bump by UVS deviation from 50.
    const base = 0.55;
    const adjustment = (uvs - 50) / 250; // UVS 75 -> +0.10, UVS 25 -> -0.10
    const p = base + adjustment;
    return Math.min(0.9, Math.max(0.05, p));
  };

  const combinedPhantomProb =
    phantomParlayLegs.length > 0
      ? phantomParlayLegs.reduce(
          (acc, leg) => acc * estimateWinProbFromUvs(leg.uvs),
          1,
        )
      : 0;

  const [activeTab, setActiveTab] = useState<
    "heatmap" | "hot" | "live" | "sports" | "tracker" | "books"
  >("heatmap");
  const [selectedSport, setSelectedSport] = useState<string>(sportOptions[0] ?? "");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [booksLeague, setBooksLeague] = useState<"nba" | "nfl" | "mlb">("nba");
  const [bookEdges, setBookEdges] = useState<BookEdge[]>([]);
  const [booksError, setBooksError] = useState<string | null>(null);

  const loadEdges = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError(null);

      const response = await fetch(`${API_BASE}/dashboard/edges`);
      if (!response.ok) {
        throw new Error(`Backend error: ${response.status}`);
      }

      const data = (await response.json()) as Tile[];
      setHeatmapData(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load edges from backend:", err);
      setLoadError("Couldn't load the dashboard. The server may be unavailable; try Refresh.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    loadEdges().finally(() => setIsRefreshing(false));
  }, [loadEdges]);

  useEffect(() => {
    void loadEdges();
  }, [loadEdges]);

  useEffect(() => {
    if (activeTab !== "tracker") {
      return;
    }
    const loadPastBets = async () => {
      try {
        const response = await fetch(`${API_BASE}/tracker/bets`);
        if (response.ok) {
          const data = (await response.json()) as PastBet[];
          setPastBets(Array.isArray(data) ? data : []);
        }
      } catch {
        setPastBets([]);
      }
    };
    void loadPastBets();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "books") {
      return;
    }

    const loadBookEdges = async () => {
      try {
        setBooksError(null);
        const response = await fetch(
          `${API_BASE}/books/edges/${booksLeague}`,
        );
        if (!response.ok) {
          throw new Error(`Backend error: ${response.status}`);
        }
        const data = (await response.json()) as BookEdge[];
        setBookEdges(data);
      } catch (err) {
        console.error("Failed to load book edges:", err);
        setBooksError("Could not load best-book edges. Check backend or API key.");
      }
    };

    void loadBookEdges();
  }, [activeTab, booksLeague]);

  const currentData: Tile[] =
    activeTab === "heatmap"
      ? heatmapData
      : activeTab === "hot"
        ? hotBets
        : activeTab === "live"
          ? liveBets
          : activeTab === "sports"
            ? heatmapData.filter((t) => t.sport === selectedSport)
            : heatmapData;

  const uvsRankById = useMemo(() => {
    const sorted = [...currentData].sort((a, b) => b.uvs - a.uvs);
    const map: Record<number, number> = {};
    sorted.forEach((t, i) => {
      const prev = sorted[i - 1];
      const rank = prev && prev.uvs === t.uvs ? (map[prev.id] ?? i) : i + 1;
      map[t.id] = rank;
    });
    return map;
  }, [currentData]);

  return (
    <div>
      <div className="mb-6 rounded-2xl border border-amber-700/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
        <strong className="font-semibold">Preview.</strong> Only NBA tiles use live stats. UFC, boxing, racing and F1
        values are demo data while those models are built. For real NBA rankings, see the{" "}
        <Link to="/leaderboard" className="underline hover:text-white">Gravity Leaderboard</Link>.
      </div>
      <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white">
            Multi-sport value
          </h1>
          <p className="text-slate-500">
            One 0–100 value score across sports
          </p>
        </div>

        <div className="flex flex-col items-end gap-3">
          {/* Tabs */}
          <div className="inline-flex flex-wrap justify-end gap-1 rounded-full border border-slate-700 bg-slate-900/60 p-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            <button
              type="button"
              onClick={() => setActiveTab("heatmap")}
              className={`rounded-full px-4 py-1.5 transition-colors ${
                activeTab === "heatmap"
                  ? "bg-slate-800 text-slate-100"
                  : "hover:bg-slate-800/60"
              }`}
            >
              Global Heatmap
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("hot")}
              className={`rounded-full px-4 py-1.5 transition-colors ${
                activeTab === "hot"
                  ? "bg-emerald-600 text-white"
                  : "hover:bg-emerald-600/40 text-emerald-300"
              }`}
            >
              Suggested Hot Bets
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("live")}
              className={`rounded-full px-4 py-1.5 transition-colors ${
                activeTab === "live"
                  ? "bg-sky-600 text-white"
                  : "hover:bg-sky-600/40 text-sky-300"
              }`}
            >
              Live Edges
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("sports")}
              className={`rounded-full px-4 py-1.5 transition-colors ${
                activeTab === "sports"
                  ? "bg-purple-600 text-white"
                  : "hover:bg-purple-600/40 text-purple-300"
              }`}
            >
              By Sport
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("tracker")}
              className={`rounded-full px-4 py-1.5 transition-colors ${
                activeTab === "tracker"
                  ? "bg-amber-500 text-black"
                  : "hover:bg-amber-500/40 text-amber-300"
              }`}
            >
              Bet Tracker
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("books")}
              className={`rounded-full px-4 py-1.5 transition-colors ${
                activeTab === "books"
                  ? "bg-orange-600 text-white"
                  : "hover:bg-orange-600/40 text-orange-300"
              }`}
            >
              Best Books
            </button>
          </div>

          {/* Refresh button (for heatmap/hot/live/sports) */}
          {!["tracker", "books"].includes(activeTab) && (
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isLoading || isRefreshing}
              className="mt-1 inline-flex items-center gap-2 rounded-full border border-slate-600 bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-700/60 disabled:opacity-50"
            >
              {isLoading || isRefreshing ? (
                <>
                  <span className="h-2 w-2 animate-spin rounded-full border border-slate-400 border-t-transparent" />
                  Refreshing…
                </>
              ) : (
                "↻ Refresh"
              )}
            </button>
          )}

          {/* Sport selector (only when on "By Sport" tab) */}
          {/* League selector (only when on "Best Books" tab) */}
          {activeTab === "books" && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="uppercase tracking-[0.16em]">League</span>
              <select
                aria-label="Select league for best-book edges"
                value={booksLeague}
                onChange={(e) => setBooksLeague(e.target.value as "nba" | "nfl" | "mlb")}
                className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-100 outline-none focus:border-orange-400"
              >
                <option value="nba">NBA</option>
                <option value="nfl">NFL</option>
                <option value="mlb">MLB</option>
              </select>
            </div>
          )}

          {activeTab === "sports" && sportOptions.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="uppercase tracking-[0.16em]">Sport View</span>
              <select
                aria-label="Select sport for filtered view"
                value={selectedSport}
                onChange={(e) => setSelectedSport(e.target.value)}
                className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-100 outline-none focus:border-purple-400"
              >
                {sportOptions.map((sport) => (
                  <option key={sport} value={sport}>
                    {sport}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </header>

      {/* Main content */}
      {loadError && (
        <p className="mb-4 rounded-xl border border-rose-900/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">{loadError}</p>
      )}

      {/* Loading overlay for initial load */}
      {isLoading && heatmapData.length === 0 && (
        <div className="mb-6 flex items-center justify-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 py-12">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-500 border-t-emerald-400" />
          <span className="text-sm text-slate-400">Loading…</span>
        </div>
      )}

      {activeTab === "books" ? (
        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
              Best-Book Edges — {booksLeague.toUpperCase()}
            </h2>
            <p className="mb-4 text-xs text-slate-500">
              Moneyline edges where a book offers better odds than the consensus. Requires ODDS_API_KEY in backend .env.
            </p>
            {booksError && (
              <p className="mb-4 text-sm text-amber-400">{booksError}</p>
            )}
            {bookEdges.length === 0 && !booksError && (
              <p className="text-sm text-slate-500">No edges found for this league, or loading…</p>
            )}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {bookEdges.map((edge, idx) => (
                <div
                  key={`${edge.matchup}-${idx}`}
                  className="rounded-xl border border-slate-700 bg-slate-900/60 p-4"
                >
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
                    {edge.league} • {edge.market}
                  </p>
                  <p className="mt-1 font-semibold text-slate-100">{edge.team_or_player}</p>
                  <p className="text-xs text-slate-400">{edge.matchup}</p>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-sm font-bold text-emerald-300">
                      {(edge.edge * 100).toFixed(1)}% edge
                    </span>
                    <span className="text-xs text-slate-500">
                      Best: {edge.best_book.book} @ {edge.best_book.price > 0 ? `+${edge.best_book.price}` : edge.best_book.price}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : activeTab === "tracker" ? (
        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
              Bet Tracker Overview
            </h2>
            <div className="flex flex-wrap gap-6 text-sm text-slate-200">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
                  Total Bets Tracked
                </p>
                <p className="text-2xl font-bold">{totalTracked}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
                  Wins / Losses
                </p>
                <p className="text-2xl font-bold">
                  {wins}
                  <span className="text-slate-500"> W</span>{" "}
                  <span className="text-slate-400">/</span>{" "}
                  {losses}
                  <span className="text-slate-500"> L</span>
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
                  Historical Win Rate
                </p>
                <p className="text-2xl font-bold">{winRate.toFixed(1)}%</p>
              </div>
            </div>
          </section>

          <section className="grid gap-6 md:grid-cols-2">
            {/* Past bets & copy-forward */}
            <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
                Past Bets (Copy Forward)
              </h3>
              <p className="text-xs text-slate-500">
                Use this list to revisit past edges, see their historical win
                probability, and quickly re-queue similar bets when those
                players are on today&apos;s slate.
              </p>
              <div className="space-y-2 text-xs">
                {pastBets.length === 0 && (
                  <p className="text-slate-500">No bets tracked yet.</p>
                )}
                {pastBets.map((bet) => {
                  const availableToday = heatmapData.some(
                    (t) => t.sport === bet.sport && t.player === bet.player,
                  );

                  const statusColor =
                    bet.result === "win" ? "text-emerald-400" : "text-rose-400";

                  return (
                    <div
                      key={bet.id}
                      className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2"
                    >
                      <div>
                        <p className="font-semibold text-slate-100">
                          {bet.player}{" "}
                          <span className="text-slate-500">({bet.sport})</span>
                        </p>
                        <p className="text-[0.7rem] text-slate-500">
                          Result:{" "}
                          <span className={statusColor}>{bet.result}</span> • UVS{" "}
                          {bet.uvsAtBet} • Model win prob{" "}
                          {(bet.winProb * 100).toFixed(1)}% • {bet.date}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {availableToday ? (
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-emerald-300">
                            Available Today
                          </span>
                        ) : (
                          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-slate-400">
                            Not on today&apos;s board
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Stay-away & neglected hot players */}
            <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-rose-400">
                  Practice: Stay-Away Signals
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Focus on why certain edges underperformed. These are bets
                  with strong UVS but poor actual outcomes—use them to refine
                  what you should avoid.
                </p>
                <ul className="mt-2 space-y-1 text-xs text-slate-300">
                  {pastBets
                    .filter((b) => b.result === "loss" && b.uvsAtBet >= 75)
                    .map((b) => (
                      <li key={b.id} className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                        <span>
                          {b.player} ({b.sport}) • UVS {b.uvsAtBet} • Model{" "}
                          {(b.winProb * 100).toFixed(1)}% on {b.date}
                        </span>
                      </li>
                    ))}
                  {pastBets.filter((b) => b.result === "loss" && b.uvsAtBet >= 75)
                    .length === 0 && (
                    <li className="text-slate-500">
                      No high-UVS losses tracked yet. Good job staying disciplined.
                    </li>
                  )}
                </ul>
              </div>

              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-400">
                  Hot but Neglected Today
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  High-UVS players on today&apos;s board that you haven&apos;t
                  historically bet on. These can be great candidates to add to
                  your hot-bets radar.
                </p>
                <ul className="mt-2 space-y-1 text-xs text-slate-300">
                  {heatmapData
                    .filter((t) => t.uvs >= 80)
                    .filter(
                      (t) =>
                        !pastBets.some(
                          (b) => b.player === t.player && b.sport === t.sport,
                        ),
                    )
                    .map((t) => (
                      <li key={t.id} className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        <span>
                          {t.player} ({t.sport}) • UVS {t.uvs}
                        </span>
                      </li>
                    ))}
                  {heatmapData
                    .filter((t) => t.uvs >= 80)
                    .filter(
                      (t) =>
                        !pastBets.some(
                          (b) => b.player === t.player && b.sport === t.sport,
                        ),
                    ).length === 0 && (
                    <li className="text-slate-500">
                      No new hot-but-neglected players today.
                    </li>
                  )}
                </ul>
              </div>
            </div>
          </section>
        </div>
      ) : (
        <>
          {/* Main grid */}
          {!isLoading && !loadError && currentData.length === 0 && (
            <p className="py-10 text-center text-sm text-slate-500">Nothing on the board for this view yet.</p>
          )}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {currentData.map((data) => (
              <SportTile
                key={data.id}
                {...data}
                rank={uvsRankById[data.id]}
                demo={data.sport !== "NBA"}
                isInPhantom={phantomParlayIds.includes(data.id)}
                onTogglePhantom={() => togglePhantomParlayLeg(data.id)}
              />
            ))}
          </div>

          {/* Phantom parlay builder */}
          <section className="mt-8 rounded-2xl border border-violet-700/60 bg-violet-950/40 p-4">
            <div className="mb-2 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-violet-200">
                  Phantom Parlay Builder
                </h2>
                <p className="text-xs text-slate-400">
                  Sandbox picks you&apos;re curious about but not ready to fire.
                  We&apos;ll track how this &quot;ghost&quot; parlay would have
                  performed.
                </p>
              </div>
              <div className="text-right text-xs text-slate-300">
                <p>
                  Legs:{" "}
                  <span className="font-semibold">
                    {phantomParlayLegs.length}
                  </span>
                </p>
                <p>
                  Mock win prob:{" "}
                  <span className="font-semibold">
                    {phantomParlayLegs.length > 0
                      ? `${(combinedPhantomProb * 100).toFixed(1)}%`
                      : "—"}
                  </span>
                </p>
              </div>
            </div>

            {phantomParlayLegs.length === 0 ? (
              <p className="text-xs text-slate-500">
                Click &quot;Add to Phantom Parlay&quot; on any tile above to
                start building a mock parlay. This won&apos;t place a real bet
                — it just tracks what would have happened.
              </p>
            ) : (
              <div className="space-y-2 text-xs text-slate-200">
                {phantomParlayLegs.map((leg) => (
                  <div
                    key={leg.id}
                    className="flex items-center justify-between rounded-xl border border-violet-700/60 bg-slate-950/60 px-3 py-2"
                  >
                    <div>
                      <p className="font-semibold text-slate-100">
                        {leg.player}{" "}
                        <span className="text-slate-400">({leg.sport})</span>
                      </p>
                      <p className="text-[0.7rem] text-slate-500">
                        {leg.details.matchup}
                      </p>
                    </div>
                    <div className="text-right text-[0.7rem] text-slate-300">
                      <p>
                        UVS <span className="font-semibold">{leg.uvs}</span>
                      </p>
                      <p>
                        Mock win prob:{" "}
                        <span className="font-semibold">
                          {(
                            estimateWinProbFromUvs(leg.uvs) * 100
                          ).toFixed(1)}
                          %
                        </span>
                      </p>
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => setPhantomParlayIds([])}
                  className="mt-2 inline-flex items-center rounded-full border border-slate-700 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-slate-300 hover:bg-slate-800/70"
                >
                  Clear Phantom Parlay
                </button>
              </div>
            )}
          </section>
        </>
      )}

      {/* Score definitions footer */}
      <footer className="mt-12 border-t border-slate-800 pt-6">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          Score definitions
        </h3>
        <dl className="grid gap-3 text-xs text-slate-400 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="font-semibold text-slate-300">UVS (Unified Value Score)</dt>
            <dd>
              A 0–100 score that compares value across all sports. <strong className="text-slate-200">Higher is better.</strong> Hot Bets use UVS ≥ 80; Live Edges use UVS ≥ 60.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-300">Gravity Score (NBA)</dt>
            <dd>
              Raw impact formula: (3PA × 1.5) + (Drives × 1.2) + (Assists × 2) ÷ (Turnovers + 1). <strong className="text-slate-200">Higher is better.</strong> Balances spacing (3PA) against rim pressure (drives) and clean playmaking. We scale the raw score to 0–100 UVS.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-300">Edge Alert</dt>
            <dd>
              Shown when UVS meets our edge threshold (e.g. ≥ 65–70). Indicates a
              spot the model flags as having above-average value.
            </dd>
          </div>
        </dl>
      </footer>
    </div>
  );
};

export default Dashboard;

