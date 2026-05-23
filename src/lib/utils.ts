export function formatSwedishDate(dateStr: string | null, fallback = 'Okänt datum'): string {
  if (!dateStr) return fallback;
  const today = new Date().toISOString().split('T')[0];
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
  return d.toISOString().slice(0, 10);
}

export function todayIso(): string {
  return toIsoDate(new Date());
}

export function addDaysFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
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
