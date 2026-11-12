export type Sport = {
  key: string;
  label: string;
  name: string;
  live: boolean;
  /** Sport name used by the multi-sport demo tiles, if that sport has any. */
  demoTiles?: string;
  plan: string;
};

export const SPORTS: Sport[] = [
  { key: "nba", label: "NBA", name: "NBA", live: true, demoTiles: "NBA", plan: "" },
  { key: "nfl", label: "NFL", name: "NFL", live: true, plan: "Target share, air yards and red-zone usage for player props." },
  { key: "mlb", label: "MLB", name: "MLB", live: false, plan: "Strikeout, hits and total-bases props against tonight's starter." },
  { key: "nhl", label: "NHL", name: "NHL", live: false, plan: "Shots on goal and points props with line-mate context." },
  { key: "ncaab", label: "NCAAB", name: "College basketball", live: false, plan: "Gravity Score and props for college hoops." },
  { key: "soccer", label: "Soccer", name: "Soccer", live: false, plan: "Shots, shots on target and chance creation by league." },
  { key: "ufc", label: "UFC", name: "UFC", live: false, demoTiles: "UFC", plan: "Striking and grappling efficiency vs the opponent's defense." },
  { key: "boxing", label: "Boxing", name: "Boxing", live: false, demoTiles: "Boxing", plan: "Punch output and accuracy matchups." },
  { key: "golf", label: "Golf", name: "Golf", live: false, plan: "Strokes-gained form against the course profile." },
  { key: "f1", label: "F1", name: "Formula 1", live: false, demoTiles: "F1", plan: "Qualifying and race pace by circuit type." },
  { key: "racing", label: "Horse Racing", name: "Horse racing", live: false, demoTiles: "Horse Racing", plan: "Speed figures and track suitability." },
];

export const SPORT_BY_KEY = Object.fromEntries(SPORTS.map((s) => [s.key, s])) as Record<string, Sport>;

/** The sport a URL belongs to: /sports/:key pages, otherwise NBA (the main site), or "all" for the demo dashboard. */
export function sportForPath(pathname: string): string {
  const match = pathname.match(/^\/sports\/([^/]+)/);
  if (match) return match[1];
  if (pathname.startsWith("/dashboard")) return "all";
  return "nba";
}
