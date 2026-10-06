/**
 * Egen räkning av hur funktioner används (BIN-1438) — ren validering + plan för ökningar.
 *
 * recordEvent (index.ts) skriver eventStats/{YYYY-MM-DD}; klienter når inte samlingen
 * (firestore.rules). Allt klienten skickar prövas här mot ETT fast ordförråd innan det blir
 * en fältsökväg i Firestore. Det som inte finns i ordförrådet — okänt namn, okänd egenskap,
 * okänt värde, tal (utom step_reached), `__proto__`, punkter i nycklar — släpps tyst och
 * blir aldrig en nyckel. Därför kan dagdokumentet inte växa obegränsat, och inga id:n
 * (tmdbId, providerId) eller fritext når Firestore.
 *
 * Ren modul (ingen firebase-admin) så att den testas under rotens vitest, och så att
 * klientens paritetstest (src/lib/analytics.parity.test.ts) kan läsa ordförrådet.
 */

export { stockholmDayId } from '../util/dayId';

/** Längsta sträng som ens prövas mot ordförrådet. */
export const MAX_STRING_LENGTH = 40;
/** Flest händelser som läses ur ett anrop; resten släpps. */
export const MAX_EVENTS_PER_CALL = 50;

/** onboarding_completed.step_reached: heltal i det här intervallet blir nyckeln '1'…'5'. */
export const STEP_REACHED_MIN = 1;
export const STEP_REACHED_MAX = 5;

/**
 * Ordförrådet: händelse → tillåten egenskap → tillåtna strängvärden.
 * step_reached är ett heltal och prövas för sig (se STEP_REACHED_*); dess värdelista här
 * är tom och används aldrig för strängar.
 */
export const EVENT_VOCABULARY = {
  signed_up: {},
  signed_in: { method: ['google', 'email'] },
  onboarding_completed: { step_reached: [] },
  title_added_watchlist: {},
  advisor_action_taken: { action: ['pause', 'resume', 'subscribe', 'catchup'] },
  provider_clicked: { offerType: ['subscription', 'rent', 'buy', 'free'] },
  share_clicked: { surface: ['title', 'list', 'profile'], method: ['native', 'copy'] },
  price_check_total_shown: { surface: ['calculator', 'home'] },
  price_check_save_clicked: {},
} as const satisfies Record<string, Record<string, readonly string[]>>;

export type CountedEventName = keyof typeof EVENT_VOCABULARY;
export const COUNTED_EVENT_NAMES = Object.keys(EVENT_VOCABULARY) as CountedEventName[];

// Uppslag via Map, aldrig via objektindex: `__proto__`, `constructor` och liknande kan
// då inte träffa något ärvt.
const VOCAB: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>> = new Map(
  Object.entries(EVENT_VOCABULARY).map(([event, props]) => [
    event,
    new Map(Object.entries(props).map(([prop, values]) => [prop, new Set<string>(values)])),
  ]),
);

const STEP_PROP = 'step_reached';
const STEP_EVENT = 'onboarding_completed';

export interface Increment {
  path: string[];
  delta: number;
}

function ownEntries(value: unknown): [string, unknown][] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>);
}

/** Värdet som nyckel, eller null om det inte hör till ordförrådet. */
function propValueKey(event: string, prop: string, raw: unknown): string | null {
  const allowed = VOCAB.get(event)?.get(prop);
  if (!allowed) return null;
  if (event === STEP_EVENT && prop === STEP_PROP) {
    if (typeof raw !== 'number' || !Number.isInteger(raw)) return null;
    if (raw < STEP_REACHED_MIN || raw > STEP_REACHED_MAX) return null;
    return String(raw);
  }
  if (typeof raw !== 'string' || raw.length > MAX_STRING_LENGTH) return null;
  return allowed.has(raw) ? raw : null;
}

/**
 * Översätter klientens `{ events: [{ name, props? }] }` till summerade ökningar.
 * Tom lista = inget överlevde = ingen skrivning.
 */
export function planIncrements(raw: unknown): Increment[] {
  if (!raw || typeof raw !== 'object') return [];
  const events = (raw as { events?: unknown }).events;
  if (!Array.isArray(events)) return [];

  const totals = new Map<string, Increment>();
  const add = (path: string[]) => {
    const key = path.join('\u0000');
    const hit = totals.get(key);
    if (hit) hit.delta += 1;
    else totals.set(key, { path, delta: 1 });
  };

  for (const entry of events.slice(0, MAX_EVENTS_PER_CALL)) {
    if (!entry || typeof entry !== 'object') continue;
    const name = (entry as { name?: unknown }).name;
    if (typeof name !== 'string' || name.length > MAX_STRING_LENGTH || !VOCAB.has(name)) continue;
    add(['counts', name]);
    for (const [prop, value] of ownEntries((entry as { props?: unknown }).props)) {
      if (prop.length > MAX_STRING_LENGTH) continue;
      const valueKey = propValueKey(name, prop, value);
      if (valueKey !== null) add(['props', name, prop, valueKey]);
    }
  }
  return [...totals.values()];
}

/** Alla sökvägar ordförrådet över huvud taget kan skapa — taket för dagdokumentets storlek. */
export function allPossiblePaths(): string[][] {
  const paths: string[][] = [];
  for (const [event, props] of VOCAB) {
    paths.push(['counts', event]);
    for (const [prop, values] of props) {
      const keys = event === STEP_EVENT && prop === STEP_PROP
        ? Array.from({ length: STEP_REACHED_MAX - STEP_REACHED_MIN + 1 }, (_, i) => String(STEP_REACHED_MIN + i))
        : [...values];
      for (const v of keys) paths.push(['props', event, prop, v]);
    }
  }
  return paths;
}

/**
 * Bygg det nästlade dokument som skrivs med en merge: varje ökning läggs på sin sökväg,
 * och maps som redan skapats av en tidigare ökning i samma anrop återanvänds.
 * `toValue` gör ökningen till ett skrivvärde (FieldValue.increment i funktionen), så att
 * byggaren kan testas utan firebase-admin.
 */
export function buildIncrementPayload(
  increments: Increment[],
  toValue: (delta: number) => unknown,
): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const inc of increments) {
    let node = root;
    for (let i = 0; i < inc.path.length - 1; i++) {
      const seg = inc.path[i];
      if (typeof node[seg] !== 'object' || node[seg] === null) node[seg] = {};
      node = node[seg] as Record<string, unknown>;
    }
    node[inc.path[inc.path.length - 1]] = toValue(inc.delta);
  }
  return root;
}
