// BIN-176 — "Ask Binge" accuracy-eval harness: shared filter schema + system prompt.
//
// This is the contract the LLM (Gemini Flash-Lite) must translate a natural-language
// sentence into. The LLM NEVER sees the catalog — it only emits this structured
// filter; retrieval stays free via TMDB + the existing rule engine. So the only thing
// the eval measures is translation accuracy of sentence -> filter.
//
// Enum values mirror the REAL filter dimensions already in the app:
//   - genreIds        TMDB genre ids (src/lib/tmdb/genreLabels.ts)
//   - mood            src/lib/moodLens.ts MOODS
//   - runtimeMax      src/lib/runtimeLens.ts RUNTIME_BUDGETS
//   - providerIds     src/lib/tmdb/providers.ts SWEDISH_PROVIDERS
//   - mediaType / excludeSeen / myProvidersOnly / voteAverageMin / decade / originalLanguage / sortBy
//
// Keep this file dependency-free (plain ESM) so the eval runs with bare `node`.

/** TMDB genre ids → Swedish label (subset most likely referenced in NL). */
export const GENRES = {
  28: 'Action', 12: 'Äventyr', 16: 'Animerat', 35: 'Komedi', 80: 'Kriminal',
  99: 'Dokumentär', 18: 'Drama', 10751: 'Familj', 14: 'Fantasy', 36: 'Historia',
  27: 'Skräck', 10402: 'Musik', 9648: 'Mysterium', 10749: 'Romantik',
  878: 'Science Fiction', 53: 'Thriller', 10752: 'Krig', 37: 'Western',
  10759: 'Action & Äventyr', 10765: 'Sci-Fi & Fantasy',
};

/** Mood ids (src/lib/moodLens.ts). */
export const MOODS = ['mysig', 'spanning', 'skratta', 'tankvard', 'skrack'];

/** Runtime budgets in minutes (src/lib/runtimeLens.ts). */
export const RUNTIME_BUDGETS = [30, 60, 90, 120];

/** Canonical Swedish provider ids (src/lib/tmdb/providers.ts). */
export const PROVIDERS = {
  8: 'Netflix', 119: 'Prime Video', 337: 'Disney+', 384: 'Max', 76: 'Viaplay',
  520: 'SVT Play', 489: 'TV4 Play', 350: 'Apple TV+', 531: 'Paramount+',
  510: 'Discovery+', 431: 'SkyShowtime', 323: 'Crunchyroll',
};

/**
 * The Gemini structured-output response schema (OpenAPI subset that the
 * Generative Language API accepts as `responseSchema`). All fields optional —
 * the model emits only what the sentence actually constrains.
 */
export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    mediaType: { type: 'string', enum: ['movie', 'tv', 'all'] },
    genreIds: { type: 'array', items: { type: 'integer' } },
    mood: { type: 'string', enum: MOODS },
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

const genreList = Object.entries(GENRES).map(([id, name]) => `${id}=${name}`).join(', ');
const providerList = Object.entries(PROVIDERS).map(([id, name]) => `${id}=${name}`).join(', ');

/**
 * System prompt. Swedish-first (the app's language) — users type Swedish or English.
 * Emphasis: emit ONLY constrained fields; map free-text intent onto the closed enums.
 */
export const SYSTEM_PROMPT = `Du är en sököversättare för Binge, en svensk streaming-tracker. Du översätter en användares mening (svenska eller engelska) till ett STRUKTURERAT filter som JSON. Du föreslår ALDRIG titlar och hittar ALDRIG på fält — du fyller bara i de fält som meningen faktiskt begränsar. Utelämna allt som inte nämns.

Fält och tillåtna värden:
- mediaType: "movie" (film), "tv" (serie), "all". Sätt bara om användaren tydligt menar det ena.
- genreIds: lista av TMDB-genre-id. Giltiga: ${genreList}. För action på serier, använd 10759. För sci-fi-serier använd 10765, för sci-fi-film 878.
- mood: en av ${MOODS.join(', ')}. mysig=komedi/familj/romantik/animerat, spanning=thriller/krim/mystik/action, skratta=komedi, tankvard=drama/dokumentär/historia/krig, skrack=skräck. Använd mood när meningen uttrycker en KÄNSLA ("mysigt", "något att skratta åt", "nervkittlande") snarare än en exakt genre. Använd inte både mood och genreIds för samma avsikt.
- runtimeMax: max-längd i minuter, en av ${RUNTIME_BUDGETS.join(', ')}. "under 90 min" -> 90, "kort" -> 30, "max två timmar" -> 120, "någon timme" -> 60.
- providerIds: lista av tjänst-id. Giltiga: ${providerList}.
- myProvidersOnly: true om användaren säger "mina tjänster", "det jag har", "som jag betalar för".
- excludeSeen: true om användaren säger "som jag inte sett", "inte börjat på", "nytt för mig".
- voteAverageMin: lägsta betyg 0–9 (steg 0.5). "högt betyg"/"hyllad"/"välrecenserad" -> 7.5, "riktigt bra" -> 8.
- decade: "1960".."2020" om ett årtionde nämns ("80-tal" -> "1980", "från 90-talet" -> "1990").
- originalLanguage: ISO-639-1 om ett språk/ursprung nämns ("svensk" -> "sv", "nordisk" -> "sv", "koreansk" -> "ko", "japansk anime" -> "ja").
- sortBy: "vote_average.desc" om användaren vill ha "bäst"/"högst betyg först", annars utelämna (default popularitet).

Svara ENDAST med giltig JSON enligt schemat. Inga förklaringar.`;

/** Field names the grader scores. */
export const SCORED_FIELDS = [
  'mediaType', 'genreIds', 'mood', 'runtimeMax', 'providerIds',
  'myProvidersOnly', 'excludeSeen', 'voteAverageMin', 'decade',
  'originalLanguage', 'sortBy',
];
