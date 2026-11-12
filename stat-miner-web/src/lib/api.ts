export const API_BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export type GravityComponents = {
  spacing: number;
  rim_pressure: number;
  playmaking: number;
};

export type PlayerRow = {
  player_id: number;
  player_name: string;
  slug: string;
  team: string;
  games: number;
  minutes: number;
  three_pa: number;
  drives: number;
  drives_estimated: boolean;
  assists: number;
  turnovers: number;
  gravity: number;
  uvs: number;
  edge_alert: boolean;
  rank: number;
  percentile: number;
  components: GravityComponents;
};

export type BoardMeta = {
  season: string;
  as_of: string;
  source: "live" | "snapshot";
  formula: string;
  league_size: number;
};

export type Leaderboard = BoardMeta & { players: PlayerRow[] };
export type PlayerProfile = BoardMeta & { player: PlayerRow };

export class ApiError extends Error {
  status: number;
  candidates: string[];

  constructor(status: number, message: string, candidates: string[] = []) {
    super(message);
    this.status = status;
    this.candidates = candidates;
  }
}

export async function getJson<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`);
  } catch {
    throw new ApiError(0, "Can't reach the Gravity Score server. Check your connection and try again.");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = body?.detail;
    if (detail && typeof detail === "object") {
      throw new ApiError(response.status, detail.message ?? "Request failed", detail.candidates ?? []);
    }
    const fallback =
      response.status === 503
        ? "NBA stats are temporarily unavailable. Please try again shortly."
        : `Request failed (${response.status})`;
    throw new ApiError(response.status, typeof detail === "string" ? detail : fallback);
  }
  return (await response.json()) as T;
}

export function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError(0, err instanceof Error ? err.message : "Something went wrong");
}

const leaderboardCache = new Map<string, Promise<Leaderboard>>();

export function loadLeaderboard(season: string): Promise<Leaderboard> {
  let pending = leaderboardCache.get(season);
  if (!pending) {
    pending = getJson<Leaderboard>(`/nba/leaderboard?season=${encodeURIComponent(season)}`);
    pending.catch(() => leaderboardCache.delete(season));
    leaderboardCache.set(season, pending);
  }
  return pending;
}

export function loadPlayer(slug: string, season: string): Promise<PlayerProfile> {
  return getJson<PlayerProfile>(
    `/nba/players/${encodeURIComponent(slug)}?season=${encodeURIComponent(season)}`,
  );
}
