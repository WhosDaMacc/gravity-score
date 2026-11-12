export function currentSeason(now = new Date()): string {
  const year = now.getFullYear();
  const start = now.getMonth() >= 9 ? year : year - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

export function recentSeasons(count = 2): string[] {
  const start = Number(currentSeason().slice(0, 4));
  return Array.from({ length: count }, (_, i) => `${start - i}-${String(start - i + 1).slice(-2)}`);
}

export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function fmt(value: number, digits = 1): string {
  return value.toFixed(digits);
}

export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th"}`;
}

export function formatAsOf(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function uvsTone(uvs: number): string {
  if (uvs >= 80) return "text-emerald-300";
  if (uvs >= 65) return "text-teal-300";
  if (uvs >= 40) return "text-sky-300";
  return "text-slate-400";
}
