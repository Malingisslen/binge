/**
 * Fråga Binge LLM-fallback — pure logic (prompt, schema, query normalization, and
 * the security-critical output sanitizer). No network, no firebase-admin — unit-tested
 * in isolation (parseLogic.test.ts).
 *
 * The LLM only runs when the deterministic parser (src/lib/askBinge/parseSearch.ts)
 * extracted nothing — the fuzzy residual (similes, slang). It translates the sentence
 * into the SAME AskFilter the deterministic path produces, so the results surface is
 * unchanged. We NEVER trust the model's raw JSON: validateAndClampFilter() drops
 * unknown fields and clamps every value to a fixed vocabulary before it leaves the
 * function (mirrors the closed enums in src/lib/askBinge/types.ts + parseSearch.ts).
 *
 * Vocab MUST mirror src/lib/tmdb/{genreLabels,providers}.ts, moodLens.ts, runtimeLens.ts.
 */

export type AskMood = 'mysig' | 'spanning' | 'skratta' | 'tankvard' | 'skrack';
export type AskSort = 'popularity.desc' | 'vote_average.desc';

export interface AskFilter {
  mediaType?: 'movie' | 'tv';
  genreIds?: number[];
  mood?: AskMood;
  runtimeMax?: number;
  providerIds?: number[];
  myProvidersOnly?: boolean;
  excludeSeen?: boolean;
  voteAverageMin?: number;
  decade?: string;
  originalLanguage?: string;
  sortBy?: AskSort;
}

export const MOODS: readonly AskMood[] = ['mysig', 'spanning', 'skratta', 'tankvard', 'skrack'];
export const RUNTIME_BUDGETS: readonly number[] = [30, 60, 90, 120];

// Standard TMDB genre ids (movie + tv variants). Mirrors GENRE_LABELS.
export const VALID_GENRE_IDS = new Set([
  28, 12, 16, 35, 80, 99, 18, 10751, 14, 36, 27, 10402, 9648, 10749, 878, 10770,
  53, 10752, 37, 10759, 10762, 10763, 10764, 10765, 10766, 10767, 10768,
]);

// Canonical Swedish provider ids. Mirrors SWEDISH_PROVIDERS.
export const VALID_PROVIDER_IDS = new Set([8, 119, 337, 384, 76, 520, 489, 350, 531, 510, 431, 323]);

// ISO-639-1 languages the deterministic parser maps to (no 'en' — it's too broad).
export const VALID_LANGS = new Set(['sv', 'da', 'no', 'fi', 'ko', 'ja', 'fr', 'es', 'de', 'it', 'ru', 'hi']);

const GENRE_HINT = '28=Action(film), 10759=Action&Äventyr(serie), 35=Komedi, 18=Drama, 53=Thriller, 80=Kriminal, 9648=Mysterium, 27=Skräck, 10749=Romantik, 99=Dokumentär, 16=Animerat, 10751=Familj, 14=Fantasy, 878=Sci-Fi(film), 10765=Sci-Fi&Fantasy(serie), 36=Historia, 10752=Krig, 37=Western, 12=Äventyr, 10402=Musik';
const PROVIDER_HINT = '8=Netflix, 119=Prime Video, 337=Disney+, 384=Max, 76=Viaplay, 520=SVT Play, 489=TV4 Play, 350=Apple TV+, 531=Paramount+, 510=Discovery+, 431=SkyShowtime, 323=Crunchyroll';

/** System prompt — kept terse; the model only handles queries rules couldn't. */
export const SYSTEM_PROMPT = `Du är en sököversättare för Binge, en svensk streaming-tracker. Översätt användarens mening till ett STRUKTURERAT filter (JSON). Fyll BARA i fält som meningen uttryckligen styr — utelämna allt annat, gissa aldrig betyg/sortering. Föreslå aldrig titlar.

Fält:
- mediaType: "movie" eller "tv" (bara om tydligt).
- genreIds: TMDB-id: ${GENRE_HINT}. Action/Sci-Fi: använd serie-varianten för serier.
- mood: en av ${MOODS.join(', ')} — endast för rena känsloord utan namngiven genre.
- runtimeMax: ${RUNTIME_BUDGETS.join('/')} (minuter) om en längd nämns.
- providerIds: ${PROVIDER_HINT}.
- myProvidersOnly: true vid "mina tjänster".
- excludeSeen: true vid "inte sett"/"inte börjat".
- voteAverageMin: 7.5 vid "hyllad/högt betyg", 8 vid "bäst/riktigt bra" — annars utelämna.
- decade: startår som sträng, t.ex. "1980".
- originalLanguage: ISO-639-1 (sv/da/no/ko/ja/fr/es/de/it/ru/hi).
- sortBy: "vote_average.desc" endast vid uttrycklig rangordning efter betyg.

Svara ENDAST med giltig JSON.`;

/** Gemini responseSchema (OpenAPI subset; enum only on string fields). */
export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    mediaType: { type: 'string', enum: ['movie', 'tv'] },
    genreIds: { type: 'array', items: { type: 'integer' } },
    mood: { type: 'string', enum: [...MOODS] },
    runtimeMax: { type: 'integer' },
    providerIds: { type: 'array', items: { type: 'integer' } },
    myProvidersOnly: { type: 'boolean' },
    excludeSeen: { type: 'boolean' },
    voteAverageMin: { type: 'number' },
    decade: { type: 'string' },
    originalLanguage: { type: 'string' },
    sortBy: { type: 'string', enum: ['popularity.desc', 'vote_average.desc'] },
  },
};

/** Lowercase + collapse whitespace — the cache key basis. */
export function normalizeQuery(raw: string): string {
  return raw.toLocaleLowerCase('sv').trim().replace(/\s+/g, ' ');
}

function clampGenreList(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const ids = [...new Set(raw.filter((x): x is number => typeof x === 'number' && VALID_GENRE_IDS.has(x)))].slice(0, 5);
  return ids.length ? ids : undefined;
}
function clampProviderList(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const ids = [...new Set(raw.filter((x): x is number => typeof x === 'number' && VALID_PROVIDER_IDS.has(x)))].slice(0, 8);
  return ids.length ? ids : undefined;
}

/**
 * Turn the model's arbitrary JSON into a clean AskFilter: only known fields, every
 * value clamped to the allowed vocabulary. This is the trust boundary — the output
 * is safe to feed into TMDB discover params downstream.
 */
export function validateAndClampFilter(raw: unknown): AskFilter {
  const out: AskFilter = {};
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;

  if (r.mediaType === 'movie' || r.mediaType === 'tv') out.mediaType = r.mediaType;

  const genres = clampGenreList(r.genreIds);
  if (genres) out.genreIds = genres;

  if (typeof r.mood === 'string' && (MOODS as readonly string[]).includes(r.mood)) out.mood = r.mood as AskMood;

  if (typeof r.runtimeMax === 'number' && RUNTIME_BUDGETS.includes(r.runtimeMax)) out.runtimeMax = r.runtimeMax;

  const providers = clampProviderList(r.providerIds);
  if (providers) out.providerIds = providers;

  if (r.myProvidersOnly === true) out.myProvidersOnly = true;
  if (r.excludeSeen === true) out.excludeSeen = true;

  if (typeof r.voteAverageMin === 'number' && r.voteAverageMin > 0 && r.voteAverageMin <= 9) {
    const snapped = Math.round(r.voteAverageMin * 2) / 2; // snap to 0.5
    if (snapped > 0) out.voteAverageMin = snapped; // a value < 0.25 snaps to 0 → no constraint, drop it
  }

  if (typeof r.decade === 'string' && /^(19|20)\d0$/.test(r.decade)) out.decade = r.decade;

  if (typeof r.originalLanguage === 'string' && VALID_LANGS.has(r.originalLanguage)) out.originalLanguage = r.originalLanguage;

  if (r.sortBy === 'vote_average.desc') out.sortBy = r.sortBy;

  return out;
}

/** Build the Gemini generateContent request body for a query. */
export function buildGeminiBody(query: string): Record<string, unknown> {
  return {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: query }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, temperature: 0 },
  };
}

/** Extract the model's JSON text from a generateContent response, or null. */
export function extractFilterJson(apiJson: unknown): AskFilter | null {
  const text = (apiJson as { candidates?: { content?: { parts?: { text?: string }[] } }[] })
    ?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') return null;
  try {
    return validateAndClampFilter(JSON.parse(text));
  } catch {
    return null;
  }
}
