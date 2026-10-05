// Hur färskt ett katalogpris är, för prissidan (/streamingpriser/). Ren — `now`
// skickas in, så sidan jämför mot klientens klocka vid rendering och testerna mot
// en fast dag.
//
// Ett saknat, felformaterat eller framtida datum räknas som OKONTROLLERAT: sidan
// får aldrig se mer kontrollerad ut än den är.

/**
 * Hur många dagar ett kontrollerat pris visas utan förbehåll. Prisagenten är tänkt
 * att köra en gång i månaden (docs/price-agent-runbook.md); ett pris som ingen läst
 * på PRICE_STALE_DAYS dagar får "kan vara inaktuell".
 */
export const PRICE_STALE_DAYS = 120;

export type PriceFreshness =
  | { kind: 'unverified' }
  | { kind: 'fresh'; date: string }
  | { kind: 'stale'; date: string };

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Lokal midnatt för ett giltigt 'YYYY-MM-DD', annars null (t.ex. '2026-02-30'). */
export function parseIsoDay(value: string | undefined): Date | null {
  if (typeof value !== 'string') return null;
  const m = ISO_DAY.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

export function priceFreshness(
  verifiedDate: string | undefined,
  now: Date,
  maxAgeDays = PRICE_STALE_DAYS,
): PriceFreshness {
  const verified = parseIsoDay(verifiedDate);
  if (!verified || !verifiedDate) return { kind: 'unverified' };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (verified.getTime() > today.getTime()) return { kind: 'unverified' };
  const ageDays = Math.round((today.getTime() - verified.getTime()) / 86_400_000);
  return ageDays > maxAgeDays
    ? { kind: 'stale', date: verifiedDate }
    : { kind: 'fresh', date: verifiedDate };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

/**
 * '2026-07-02' → '2 jul 2026'. Handskrivet i stället för toLocaleDateString så
 * att serverrenderingen och klienten ger samma sträng. Ogiltigt → '–'.
 */
export function formatPriceDay(value: string | undefined): string {
  const d = parseIsoDay(value);
  if (!d) return '–';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** '2026-09' eller '2026-09-02' → 'sep 2026'. Ogiltigt → '–'. */
export function formatPriceMonth(value: string): string {
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(value);
  if (!m) return '–';
  const month = Number(m[2]);
  if (month < 1 || month > 12) return '–';
  return `${MONTHS[month - 1]} ${m[1]}`;
}
