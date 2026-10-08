/**
 * Binges egen räkning av hur funktioner används (BIN-1438).
 *
 * trackEvent samlar händelser i minnet och skickar dem till den anropbara funktionen
 * recordEvent, som lägger dem till dagens summa i eventStats/{YYYY-MM-DD}. Bara en summa
 * per dag sparas — aldrig vem som gjorde något — och ingenting lagras på enheten, så inga
 * cookies och ingen samtyckesruta behövs.
 *
 * Bara händelserna i COUNTED_EVENTS skickas; övriga trackEvent-anrop är no-ops, så
 * frekventa händelser som search_submitted inte kostar anrop. Servern prövar dessutom
 * varje egenskap mot sitt eget ordförråd (functions/src/eventStats/logic.ts) och släpper
 * allt annat; analytics.parity.test.ts håller listorna lika.
 *
 * Utskick: högst ett anrop var 30:e sekund (max 50 händelser) och ett vid `pagehide`.
 * Fire-and-forget — ett misslyckat anrop sväljs. Händelser i en flik som stängs innan
 * utskicket hinner fram kan tappas; räkningen är ungefärlig.
 *
 * Events are typed in AnalyticsEvent — add a new member + fire site-wide
 * via trackEvent('name', { ...props }).
 *
 * We avoid PII in event props: no emails, no full URLs, no note text, no
 * review text.
 */

export type AnalyticsEvent =
  | { name: 'signed_up'; props?: Record<string, never> }
  | { name: 'signed_in'; props: { method: 'google' | 'email' } }
  | { name: 'title_added_watchlist'; props: { mediaType: 'movie' | 'tv'; status: 'vill_se' | 'mina' | 'sedd' | 'avbruten' } }
  | { name: 'first_title_added'; props: { mediaType: 'movie' | 'tv' } }
  | { name: 'advisor_pause_taken'; props: { providerId: number } }
  | { name: 'revival_nudge_shown'; props: { count: number } }
  | { name: 'revival_nudge_acted_on'; props: { tmdbId: number } }
  | { name: 'review_created'; props: { mediaType: 'movie' | 'tv'; hasSpoiler: boolean } }
  // Onboarding — step_reached visar var användare droppar av. Hjälper
  // optimera flödet senare (om 50% skippar vid step 3, ändra step 3).
  | { name: 'onboarding_completed'; props: { step_reached: number } }
  // Ko-fi / Swish-donate-klick i footer. Ingen payment här, bara spårning
  // av intresse så vi kan utvärdera om det är värt att bygga mer runt.
  | { name: 'donate_clicked'; props?: Record<string, never> }
  // Telemetri för React Query-fel — inga PII, bara kategori och första segment
  // av queryKey så vi kan se vilken subsystem som hostar felen.
  | { name: 'query_error'; props: { scope: string; kind: 'query' | 'mutation' } }
  | { name: 'providers_selected'; props: { count: number } }
  | { name: 'advisor_viewed'; props: { providerCount: number } }
  | { name: 'advisor_action_taken'; props: { action: 'pause' | 'resume' | 'subscribe' | 'catchup'; providerId: number } }
  | { name: 'search_submitted'; props: { resultCount: number; mediaFilter: 'all' | 'movie' | 'tv' } }
  // "Fråga Binge" NL-sök: hur många filterfält den deterministiska parsern lyckades
  // extrahera ur meningen (0 = low-confidence, kandidat för LLM-fallback).
  // lowConfidence speglar fields===0 explicit — så vi kan mäta hur ofta parsern
  // missar helt utan att räkna props.
  | { name: 'ask_binge_submitted'; props: { fields: number; lowConfidence: boolean } }
  // Resultat-utfallet för en sökning. resultBucket=0 är vår vanligaste TYSTA miss
  // (parsade fint men gav tom lista). filters = vilka filter-TYPER som var aktiva
  // (sorterat, '+'-joinat) så vi ser vilka KOMBINATIONER som strandar användare.
  // Inga råa söktermer — bara fasta filternamn + bucketad räkning (ingen PII).
  | { name: 'ask_binge_results'; props: { resultBucket: '0' | '1-9' | '10-29' | '30+'; mediaFilter: 'all' | 'movie' | 'tv'; filters: string } }
  // Användaren tog bort en tolknings-chip = explicit "du gissade fel"-signal.
  // key = AskFilter-fältet (fast uppsättning, ingen fritext).
  | { name: 'ask_binge_chip_removed'; props: { key: string } }
  // LLM fallback outcome for a low-confidence parse: did the model salvage a filter?
  | { name: 'ask_binge_ai_fallback'; props: { ok: boolean } }
  | { name: 'status_changed'; props: { mediaType: 'movie' | 'tv'; status: 'vill_se' | 'mina' | 'sedd' | 'avbruten' } }
  // Betyg satt via stjärn-toasten som dyker upp när en titel markeras sedd —
  // mäter om "betygsätt direkt"-nudgen faktiskt höjer betygsfrekvensen.
  | { name: 'rate_on_sedd'; props: { mediaType: 'movie' | 'tv' } }
  | { name: 'error_boundary_triggered'; props: { scope: string } }
  // Delningsknappen på titel, lista och profil. method skiljer telefonens
  // delningsark från kopiering, så vi ser om Web Share faktiskt används.
  | { name: 'share_clicked'; props: { surface: 'title' | 'list' | 'profile'; method: 'native' | 'copy' } }
  // Klick ut till en tjänst (Netflix, SF Anytime …) från titelsidan — tratten
  // slutar här, så det är det mest värdefulla steget att räkna. providerId är
  // det kanoniska id:t, offerType är erbjudandets typ ur streamingOffers.
  | { name: 'provider_clicked'; props: { providerId: number; offerType: 'subscription' | 'rent' | 'buy' | 'free'; mediaType: 'movie' | 'tv' } }
  // Kalkylatorn (/streamingkostnad/) och startsidans gästdemo: första gången ett
  // val ger en summa under en sidvisning, och klicket på "Logga in och spara".
  // Bara antalet betalda tjänster — vilka tjänster det är skickas inte.
  | { name: 'price_check_total_shown'; props: { surface: 'calculator' | 'home'; paidCount: number } }
  | { name: 'price_check_save_clicked'; props: { paidCount: number } };

/** Händelserna som skickas till recordEvent. Speglar serverns EVENT_VOCABULARY. */
export const COUNTED_EVENTS = [
  'signed_up',
  'signed_in',
  'onboarding_completed',
  'title_added_watchlist',
  'advisor_action_taken',
  'provider_clicked',
  'share_clicked',
  'price_check_total_shown',
  'price_check_save_clicked',
] as const satisfies readonly AnalyticsEvent['name'][];

const COUNTED: ReadonlySet<string> = new Set(COUNTED_EVENTS);

export const FLUSH_INTERVAL_MS = 30_000;
export const MAX_EVENTS_PER_CALL = 50;
// Tak för kön i minnet om utskicken inte hinner med; det som går över släpps.
const MAX_QUEUED = MAX_EVENTS_PER_CALL * 4;

type QueuedEvent = { name: string; props?: Record<string, unknown> };

const queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let pagehideBound = false;

const REGION = 'europe-west1';

// Den anropbara funktionens adress, byggd som Firebase-SDK:n bygger den. I produktion
// täcks värden av connect-src i firebase.json.
function recordEventUrl(): string {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  return process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATOR === 'true'
    ? `http://127.0.0.1:5001/${projectId}/${REGION}/recordEvent`
    : `https://${REGION}-${projectId}.cloudfunctions.net/recordEvent`;
}

// Lat och memoiserad, så att pagehide-utskickens parallella omgångar delar en import.
let appCheckImport: Promise<typeof import('@/lib/firebase/appCheck')> | null = null;
function appCheckModule(): Promise<typeof import('@/lib/firebase/appCheck')> {
  appCheckImport ??= import('@/lib/firebase/appCheck').catch((err) => {
    appCheckImport = null; // ett chunkfel får inte stänga av räkningen resten av sessionen
    throw err;
  });
  return appCheckImport;
}

// Rå `fetch` i stället för httpsCallable: SDK:n bifogar den inloggades id-token till varje
// anrop, och räknaren får inte bära vem som klickade (BIN-1438, villkor A). Bara App
// Check-token skickas. keepalive låter utskicket vid pagehide överleva att sidan stängs.
async function send(events: QueuedEvent[]): Promise<void> {
  try {
    const { getAppCheckToken } = await appCheckModule();
    const token = await getAppCheckToken();
    if (!token) return; // servern kräver App Check och hade nekat anropet ändå
    await fetch(recordEventUrl(), {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', 'X-Firebase-AppCheck': token },
      body: JSON.stringify({ data: { events } }),
    });
  } catch {
    /* sväljs — räkningen är bäst-möjlig och får aldrig påverka appen */
  }
}

/** Skickar nästa omgång (högst MAX_EVENTS_PER_CALL); `all` tömmer kön, för `pagehide`. */
function flushEvents(all = false): void {
  if (timer !== null) { clearTimeout(timer); timer = null; }
  do {
    const batch = queue.splice(0, MAX_EVENTS_PER_CALL);
    if (batch.length === 0) return;
    void send(batch);
  } while (all);
  if (queue.length > 0) timer = setTimeout(() => flushEvents(), FLUSH_INTERVAL_MS);
}

function bindPagehide(): void {
  if (pagehideBound) return;
  pagehideBound = true;
  window.addEventListener('pagehide', () => flushEvents(true));
}

export function trackEvent<T extends AnalyticsEvent['name']>(
  name: T,
  props?: Extract<AnalyticsEvent, { name: T }>['props'],
): void {
  if (typeof window === 'undefined') return;
  if (!COUNTED.has(name)) return;
  if (queue.length >= MAX_QUEUED) return;
  queue.push(props ? { name, props: { ...props } } : { name });
  bindPagehide();
  if (timer === null) timer = setTimeout(() => flushEvents(), FLUSH_INTERVAL_MS);
}
