/**
 * BIN-1444 — ren logik för priceChangeNotify: validera prisfilen sajten publicerar
 * (`/prisandringar.json`, byggd ur klientkatalogen), välj raderna som är nya nog
 * att pusha, och avgör vilka användare en rad gäller. Inga Firebase-importer, så
 * den testas utan emulator.
 */

export interface FeedRow {
  key: string;
  providerIds: number[];
  tierId: string | null;
  date: string;
  title: string;
  body: string;
}

/** En rad pushas bara medan den är högst så här många dagar gammal. */
export const PUSH_WINDOW_DAYS = 14;
/** Tak på antal rader och textlängd: filen är en extern indata som styr pushar. */
export const MAX_ROWS = 200;
const MAX_TEXT = 200;
const KEY = /^\d{1,6}-[a-z0-9_-]{0,32}-\d{4}-\d{2}(?:-\d{2})?$/;
const DATE = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/;

function isText(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_TEXT;
}

/** Filens rader, eller null om formen inte är den väntade. En trasig rad fäller hela filen. */
export function parseFeed(raw: unknown): FeedRow[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const { version, rows } = raw as { version?: unknown; rows?: unknown };
  if (version !== 1 || !Array.isArray(rows) || rows.length > MAX_ROWS) return null;
  const out: FeedRow[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') return null;
    const x = r as Record<string, unknown>;
    if (typeof x.key !== 'string' || !KEY.test(x.key)) return null;
    if (!Array.isArray(x.providerIds) || x.providerIds.length === 0 || x.providerIds.length > 10) return null;
    if (!x.providerIds.every((id) => Number.isInteger(id) && (id as number) > 0)) return null;
    if (x.tierId !== null && (typeof x.tierId !== 'string' || x.tierId.length > 32)) return null;
    if (typeof x.date !== 'string' || !DATE.test(x.date)) return null;
    if (!isText(x.title) || !isText(x.body)) return null;
    out.push({
      key: x.key,
      providerIds: x.providerIds as number[],
      tierId: x.tierId as string | null,
      date: x.date,
      title: x.title,
      body: x.body,
    });
  }
  return out;
}

/**
 * Raderna vars datum ligger högst PUSH_WINDOW_DAYS dagar före `todayId` och inte
 * efter den. Ett 'YYYY-MM'-datum räknas från månadens första dag, så en månadsrad
 * pushas bara under månadens första två veckor.
 */
export function freshRows(rows: FeedRow[], todayId: string, windowDays = PUSH_WINDOW_DAYS): FeedRow[] {
  const t = DATE.exec(todayId);
  if (!t || !t[3]) return [];
  const today = Date.UTC(Number(t[1]), Number(t[2]) - 1, Number(t[3]));
  return rows.filter((r) => {
    const m = DATE.exec(r.date)!;
    const day = Date.UTC(Number(m[1]), Number(m[2]) - 1, m[3] ? Number(m[3]) : 1);
    const age = Math.round((today - day) / 86_400_000);
    return age >= 0 && age <= windowDays;
  });
}

export interface UserCostFields {
  myProviders?: unknown;
  providerTiers?: unknown;
  providerPauses?: unknown;
}

/**
 * Gäller raden användaren? Tjänsten ska finnas bland myProviders (kanoniskt id
 * eller alias), inte vara pausad, och nivån matcha uttryckligen — samma regel som
 * banderollen. Kartorna nycklas på det kanoniska id:t, som står först i raden.
 */
export function rowAppliesTo(row: FeedRow, user: UserCostFields): boolean {
  const canonical = row.providerIds[0];
  const owned = Array.isArray(user.myProviders) ? user.myProviders : [];
  if (!owned.some((id) => row.providerIds.includes(id as number))) return false;
  const pauses = user.providerPauses as Record<string, unknown> | undefined;
  if (pauses && typeof pauses === 'object' && pauses[String(canonical)]) return false;
  if (row.tierId === null) return true;
  const tiers = user.providerTiers as Record<string, unknown> | undefined;
  return !!tiers && typeof tiers === 'object' && tiers[String(canonical)] === row.tierId;
}
