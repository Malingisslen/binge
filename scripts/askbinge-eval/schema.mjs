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
    mediaType: { type: 'string', enum: ['movie', 'tv', 'all'], description: 'movie om ordet film nämns, tv om serie nämns. Utelämna helt om oklart (sätt inte all).' },
    genreIds: { type: 'array', items: { type: 'integer' }, description: 'TMDB-genre-id för namngivna genrer. Utelämna om ingen genre namnges.' },
    mood: { type: 'string', enum: MOODS, description: 'Endast för rena känsloord utan namngiven genre. Utelämna om en genre redan angetts.' },
    runtimeMax: { type: 'integer', description: 'Max minuter (30/60/90/120) endast om en tidsgräns nämns. Utelämna annars — sätt aldrig 0.' },
    providerIds: { type: 'array', items: { type: 'integer' }, description: 'Tjänst-id endast om en tjänst namnges. Utelämna annars.' },
    myProvidersOnly: { type: 'boolean', description: 'true endast vid "mina tjänster"/"det jag har". Utelämna annars (sätt inte false).' },
    excludeSeen: { type: 'boolean', description: 'true när användaren vill ha OSETT: "inte sett", "inte börjat", "kan börja på", "nytt för mig". Detta missas lätt — sätt det när signalen finns. Utelämna annars (sätt inte false).' },
    voteAverageMin: { type: 'number', description: 'Lägsta betyg ENDAST vid uttryckligt kvalitetsord (hyllad/högt betyg->7.5, riktigt bra/bäst->8). Vardagligt "bra" räknas INTE. Utelämna annars — sätt ALDRIG 7.5 som standard.' },
    decade: { type: 'string', description: 'Startår som sträng om ett ÅRTIONDE nämns: "80-talet"->"1980", "90-talet"->"1990", "2010-talet"->"2010", "70-tal"->"1970". Detta missas lätt — sätt det när ett årtionde nämns. Utelämna annars.' },
    originalLanguage: { type: 'string', description: 'ISO-639-1 om språk/ursprung nämns: svensk/nordisk->sv, dansk->da, koreansk->ko, anime/japansk->ja. Utelämna annars (sätt inte tom sträng).' },
    sortBy: { type: 'string', enum: ['popularity.desc', 'vote_average.desc'], description: 'vote_average.desc ENDAST vid uttrycklig rangordning ("bäst...först", "mest hyllade"). Utelämna annars (sätt inte popularity.desc).' },
  },
};

const genreList = Object.entries(GENRES).map(([id, name]) => `${id}=${name}`).join(', ');
const providerList = Object.entries(PROVIDERS).map(([id, name]) => `${id}=${name}`).join(', ');

/**
 * System prompt. Swedish-first (the app's language) — users type Swedish or English.
 * Emphasis: emit ONLY constrained fields; map free-text intent onto the closed enums.
 */
export const SYSTEM_PROMPT = `Du är en sököversättare för Binge, en svensk streaming-tracker. Du översätter en användares mening (svenska eller engelska) till ett STRUKTURERAT filter som JSON. Du föreslår ALDRIG titlar.

ÖVERGRIPANDE REGEL — utelämna hellre än att gissa:
Fyll BARA i ett fält om meningen UTTRYCKLIGEN styr det. Ett fält som inte nämns ska SAKNAS HELT i svaret — sätt det INTE till 0, false, "all" eller ett standardvärde. Hitta aldrig på betyg, sortering eller längd som användaren inte bett om. Färre fält rätt är bättre än många fält gissade.

Fält och tillåtna värden:
- mediaType: "movie" (film) eller "tv" (serie). Sätt BARA om ordet film/serie eller en tydlig synonym finns. Annars utelämna (sätt INTE "all").
- genreIds: lista av TMDB-genre-id. Giltiga: ${genreList}. Om en NAMNGIVEN genre nämns, använd genreIds (inte mood). Svensk genre-lexikon: deckare/krim/kriminal->80, skräck/läskig->27, komedi->35, drama->18, thriller->53, mysterium->9648, romantik/romantisk->10749, dokumentär->99, western->37, fantasy->14, animerat/anime->16, familj/barn->10751, historisk/historia->36, krig->10752, action-FILM->28, action-SERIE->10759, science fiction-FILM->878, science fiction-SERIE/sci-fi-SERIE->10765. Vid kombinationer, ta med alla (t.ex. "romantisk komedi"->[35,10749], "historiskt drama"->[36,18], "animerad barnserie"->[16,10751]).
- mood: en av ${MOODS.join(', ')}. Använd mood ENDAST för rena känslouttryck UTAN namngiven genre: "något mysigt"/"feelgood"->mysig, "något att skratta åt" (utan ordet komedi)->skratta, "nervkittlande"/"spännande" (utan namngiven genre)->spanning, "tänkvärd"->tankvard. Om en genre redan är namngiven, använd INTE mood. Sätt aldrig både mood och genreIds för samma avsikt.
- runtimeMax: max-längd i minuter, EXAKT en av ${RUNTIME_BUDGETS.join(', ')}. Sätt BARA om en tidsgräns nämns: "under/max 90 min"->90, "kort"->30, "max två timmar"/"under två timmar"->120, "någon timme"/"på lunchen"/"innan jag somnar"->60. Inget tidsord -> utelämna (aldrig 0).
- providerIds: lista av tjänst-id. Giltiga: ${providerList}. Sätt BARA om en tjänst namnges. (HBO/HBO Max->384.)
- myProvidersOnly: true ENDAST om "mina tjänster"/"det jag har"/"som jag betalar för"/"det jag har". Annars utelämna (aldrig false).
- excludeSeen: true om användaren signalerar OSETT — fånga alla varianter: "som jag inte sett", "inte sett", "inte börjat", "inte börjat på", "jag kan börja på", "kan börja på", "nytt för mig", "som jag inte börjat på". Detta missas ofta — var uppmärksam. Annars utelämna (aldrig false).
- voteAverageMin: lägsta betyg. Sätt ENDAST vid uttryckligt KVALITETSord: "hyllad"/"högt betyg"/"välrecenserad"->7.5, "riktigt bra"/"bäst"/"mest hyllade"/"prisbelönt"->8. Vardagligt "bra"/"en bra film" är INTE ett betygskrav -> utelämna. Inget kvalitetsord -> utelämna (aldrig 0).
- decade: startåret som sträng om ett ÅRTIONDE nämns. Fånga svenska former: "80-tal"/"80-talet"/"åttiotal"->"1980", "90-talet"/"från 90-talet"->"1990", "2010-talet"->"2010", "sextiotal"->"1960", "70-tal"->"1970". Missa inte årtionden.
- originalLanguage: ISO-639-1 om språk/ursprung nämns: "svensk"/"nordisk"->"sv", "dansk"->"da", "norsk"->"no", "koreansk"->"ko", "japansk"/"anime"->"ja", "fransk"->"fr". Annars utelämna.
- sortBy: "vote_average.desc" ENDAST om användaren uttryckligen vill rangordna efter betyg ("bäst...först", "högst betyg först", "mest hyllade", "de bästa"). Vid bara ett kvalitetskrav (utan rangordning) -> utelämna. Default popularitet -> utelämna.

Svara ENDAST med giltig JSON enligt schemat, med bara de fält meningen styr. Inga förklaringar.`;

/** Field names the grader scores. */
export const SCORED_FIELDS = [
  'mediaType', 'genreIds', 'mood', 'runtimeMax', 'providerIds',
  'myProvidersOnly', 'excludeSeen', 'voteAverageMin', 'decade',
  'originalLanguage', 'sortBy',
];
