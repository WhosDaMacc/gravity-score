import { useCallback, useEffect, useState } from "react";
import { ApiError, getJson, loadLeaderboard, loadPlayer, toApiError, type Leaderboard, type PlayerProfile } from "./api";
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

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · Gravity Score` : "Gravity Score · NBA offensive gravity rankings";
  }, [title]);
}
