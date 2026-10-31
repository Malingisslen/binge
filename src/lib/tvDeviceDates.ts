const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

/** "31 okt 2026" */
export function shortSwedishDate(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "Kopplad 31 okt 2026 · senast använd idag". A TV that never reported in has no "senast använd". */
export function tvDeviceSubtitle(createdAt: Date | null, lastSeenAt: Date | null, now: Date = new Date()): string {
  const parts: string[] = [];
  if (createdAt) parts.push(`Kopplad ${shortSwedishDate(createdAt)}`);
  if (lastSeenAt) parts.push(`senast använd ${sameDay(lastSeenAt, now) ? 'idag' : shortSwedishDate(lastSeenAt)}`);
  return parts.join(' · ');
}
