// Local-calendar ISO date (YYYY-MM-DD) — NOT toISOString(), which serializes in
// UTC and reports yesterday between local midnight and the UTC offset (~02:00
// CEST for Swedish users). TMDB date strings are treated as local everywhere
// else (parsed as `dateStr + 'T00:00:00'`), so the canonical "today" must match.
// Same shape as buildEntries.toDateKey.
export function localIsoDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function formatSwedishDate(dateStr: string | null, fallback = 'Okänt datum'): string {
  if (!dateStr) return fallback;
  const today = localIsoDate(new Date());
  if (dateStr === today) return 'idag';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
}

export function formatEpisodeCode(season: number, episode: number): string {
  return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
}

export function pluralSv(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function toIsoDate(d: Date): string {
  return localIsoDate(d);
}

export function todayIso(): string {
  return toIsoDate(new Date());
}

export function addDaysFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localIsoDate(d);
}

export function daysBetween(fromIso: string, to: Date = new Date()): number {
  const a = new Date(fromIso + 'T00:00:00');
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((end.getTime() - a.getTime()) / 86400000));
}

export function shortSwedishWeekday(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('sv-SE', { weekday: 'short' }).slice(0, 3);
}
