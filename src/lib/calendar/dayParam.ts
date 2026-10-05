// UX-8: the topbar's week strip links each day to `/calendar/?day=YYYY-MM-DD`.
// Returns that day as local midnight, or null for anything that is not a real
// calendar date (a hand-edited URL must fall back to this week, not crash or
// roll 2026-02-31 over into March).
export function parseDayParam(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(year, month, day);
  if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) return null;
  return d;
}
