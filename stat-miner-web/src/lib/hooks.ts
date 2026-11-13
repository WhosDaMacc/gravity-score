import { useCallback, useEffect, useState } from "react";
import { ApiError, getJson, loadLeaderboard, loadPlayer, toApiError, type Leaderboard, type PlayerProfile } from "./api";
import { loadPicksHistory, type PicksHistory } from "./history";
import type { PropsBoard } from "./props";

type AsyncState<T> = { data?: T; error?: ApiError; loading: boolean };

function useAsync<T>(load: () => Promise<T>, deps: unknown[]): AsyncState<T> & { retry: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ loading: true });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState((prev) => ({ data: prev.data, loading: true }));
    load()
      .then((data) => alive && setState({ data, loading: false }))
      .catch((err) => alive && setState({ error: toApiError(err), loading: false }));
    return () => {
      alive = false;
    };
  }, [...deps, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}

export function useLeaderboard(season: string) {
  return useAsync<Leaderboard>(() => loadLeaderboard(season), [season]);
}

export function usePlayer(slug: string, season: string) {
  return useAsync<PlayerProfile>(() => loadPlayer(slug, season), [slug, season]);
}

export function usePropsBoard(sport: string) {
  return useAsync<PropsBoard>(() => getJson<PropsBoard>(`/props/board?sport=${sport}`), [sport]);
}

export function usePicksHistory(sport: string) {
  return useAsync<PicksHistory>(() => loadPicksHistory(sport), [sport]);
}

/**
 * A board for one explicit date (the API accepts ?date=YYYY-MM-DD). With a
 * null date nothing is fetched and the hook stays in its loading state —
 * callers use it to look ahead to the next slate once today's board is known.
 */
export function usePropsBoardForDate(sport: string, date: string | null) {
  return useAsync<PropsBoard>(
    () =>
      date
        ? getJson<PropsBoard>(`/props/board?sport=${sport}&date=${date}`)
        : new Promise<PropsBoard>(() => {}),
    [sport, date],
  );
}

export const NFL_LOOKAHEAD_DAYS = 4;

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Today's board for a sport. For the NFL, walks forward up to
 * NFL_LOOKAHEAD_DAYS days to the next slate when today is empty, so a Friday
 * visit shows Sunday's games (the returned board carries its real date).
 * Shared by the Suggested Bets page and the homepage leans section.
 */
export function useSlateBoard(sport: string) {
  const first = usePropsBoard(sport);
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [sport]);

  const baseDate = first.data?.date;
  const target = sport === "nfl" && baseDate && offset > 0 ? addDaysIso(baseDate, offset) : null;
  const dated = usePropsBoardForDate(sport, target);

  useEffect(() => {
    if (sport !== "nfl" || !baseDate) return;
    const board = offset === 0 ? first.data : dated.data;
    if (board && board.games.length === 0 && offset < NFL_LOOKAHEAD_DAYS) setOffset((o) => o + 1);
  }, [sport, baseDate, offset, first.data, dated.data]);

  const board = offset === 0 ? first.data : dated.data;
  const searching =
    sport === "nfl" &&
    !board?.games.length &&
    offset < NFL_LOOKAHEAD_DAYS &&
    (first.loading || (offset > 0 && dated.loading));
  return {
    board,
    loading: first.loading || searching || (offset > 0 && dated.loading && !dated.data),
    error: offset === 0 ? first.error : undefined,
    retry: first.retry,
    lookedAhead: offset > 0,
  };
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · Gravity Score` : "Gravity Score · NBA offensive gravity rankings";
  }, [title]);
}
