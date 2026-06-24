// BIN-176 — deterministic natural-language → AskFilter parser.
//
// The production version of the parser proven in scripts/askbinge-eval/ (vs Gemini
// 31–65%). The filter dimensions are overwhelmingly keyword-driven, so plain rules
// beat an LLM here — for free, instantly, with no hallucinated filters. The genuinely
// fuzzy residual (similes, slang the rules don't cover) is left for the LLM fallback;
// `parseSearch` returning an empty filter (isLowConfidence) is the signal to call it.
//
// Coverage is intentionally broad (Swedish + English synonyms/slang) to keep the LLM
// fallback rare. KEEP IN SYNC with scripts/askbinge-eval/deterministic.mjs.

import type { AskFilter, AskMood } from './types';

const ACTIONISH = [28, 10759, 53, 80, 9648, 12];

export function parseSearch(raw: string): AskFilter {
  const q = raw.toLocaleLowerCase('sv');
  const out: AskFilter = {};

  // --- mediaType (substring so "skräckfilm"/"dramaserie" match) ---
  const isMovie = /film|movie|långfilm|biofilm/.test(q);
  const isTv = /serie|series|\bshow\b|säsong|avsnitt|miniserie/.test(q);
  if (isMovie && !isTv) out.mediaType = 'movie';
  else if (isTv && !isMovie) out.mediaType = 'tv';

  // --- decade ---
  let decade: string | null = null;
  const four = q.match(/\b(19\d0|20\d0)[\s-]?tal/); // "2010-talet"
  if (four) decade = four[1];
  if (!decade) {
    const two = q.match(/\b(\d{2})[\s-]?tal/); // "80-talet" (00→2000 … 20→2020, else 19xx)
    if (two) { const n = Number(two[1]); decade = n <= 20 ? String(2000 + n) : String(1900 + n); }
  }
  if (!decade) {
    const words: Record<string, string> = {
      trettiotal: '1930', fyrtiotal: '1940', femtiotal: '1950', sextiotal: '1960',
      sjuttiotal: '1970', åttiotal: '1980', nittiotal: '1990', tjugohundratal: '2000',
    };
    for (const w in words) if (q.includes(w)) { decade = words[w]; break; }
  }
  if (decade) out.decade = decade;

  // --- excludeSeen (NB: no bare "nya" — "nya filmer" = new RELEASES, not unseen) ---
  if (/inte sett|inte hunnit|inte börjat|inte påbörjat|kan börja|jag inte sett|som jag inte|aldrig sett|nytt för mig|ny för mig|något nytt|osedd|missat|missade|haven'?t (started|seen|watched)|not seen|not started|unwatched|new to me/.test(q)) {
    out.excludeSeen = true;
  }

  // --- providerIds ("max" only as the service, not "max två timmar"/"max 30 min") ---
  const PROV: [RegExp, number][] = [
    [/netflix/, 8], [/viaplay/, 76], [/disney/, 337],
    [/\bhbo\b|hbo max|\bmax\b(?!\s*(?:\d|två|tva|tre|fyra|fem|sex|sju|åtta|nio|tio|en\s|minut|min\b|timm))/, 384],
    [/svt/, 520], [/tv4|cmore|\bc more\b/, 489], [/apple/, 350], [/paramount/, 531],
    [/discovery|dplay/, 510], [/skyshowtime/, 431], [/prime|amazon/, 119], [/crunchyroll/, 323],
  ];
  const pids: number[] = [];
  for (const [re, id] of PROV) if (re.test(q)) pids.push(id);
  if (pids.length) out.providerIds = [...new Set(pids)];

  // --- myProvidersOnly ---
  if (/mina tjänster|det jag har|jag betalar|på det jag har|on my services|my services/.test(q)) out.myProvidersOnly = true;

  // --- originalLanguage (\banime\b so "animerad" doesn't read as Japanese; no "en"
  //     row — TMDB with_original_language=en is ALL English content, too broad) ---
  const LANG: [RegExp, string][] = [
    [/svensk|nordisk|nordic/, 'sv'], [/dansk|danish/, 'da'], [/norsk|norwegian/, 'no'],
    [/finsk|finnish/, 'fi'], [/isländsk|icelandic/, 'is'],
    [/koreansk|korean/, 'ko'], [/japansk|\banime\b/, 'ja'], [/kinesisk|mandarin|chinese/, 'zh'],
    [/thailändsk|\bthai\b/, 'th'], [/fransk|french/, 'fr'], [/spansk|spanish|mexikansk/, 'es'],
    [/tysk|german/, 'de'], [/italiensk|italian/, 'it'], [/rysk|russian/, 'ru'],
    [/indisk|bollywood|indian|hindi/, 'hi'], [/turkisk|turkish/, 'tr'], [/polsk|polish/, 'pl'],
    [/nederländsk|holländsk|dutch/, 'nl'], [/portugisisk|brasiliansk|portuguese|brazilian/, 'pt'],
    [/arabisk|arabic/, 'ar'], [/grekisk|greek/, 'el'],
  ];
  for (const [re, code] of LANG) if (re.test(q)) { out.originalLanguage = code; break; }

  // --- runtimeMax (numeric first, then phrases; 120 > 90 > 30 > 60 in match order) ---
  const mins = q.match(/(\d{2,3})\s*min/);
  if (mins) { const n = Number(mins[1]); out.runtimeMax = n <= 30 ? 30 : n <= 60 ? 60 : n <= 90 ? 90 : 120; }
  else if (/två timmar|tva timmar|2 timmar|ett par timmar|par timmar|\b2\s*h\b/.test(q)) out.runtimeMax = 120;
  else if (/en och en halv timme|halvannan timme|1[.,]5\s*tim/.test(q)) out.runtimeMax = 90;
  else if (/\bkort\b|korta|halvtimme|halv timme/.test(q)) out.runtimeMax = 30;
  else if (/någon timme|en timme|nån timme|\b1\s*h\b|på lunchen|innan jag somnar|innan läggdags/.test(q)) out.runtimeMax = 60;

  // --- voteAverageMin (explicit quality words only; "bra" alone never counts) ---
  if (/riktigt bra|mest hyllade|prisbelön|oscars|kritikerrosad|kritikerhyllad|mästerverk|masterpiece|topprankad|toppbetyg|femstjärnig|fem stjärnor/.test(q)) out.voteAverageMin = 8;
  else if (/hyllad|hyllade|högt betyg|bra betyg|välrecenserad|välrenommerad|high.?rated/.test(q)) out.voteAverageMin = 7.5;

  // --- sortBy (explicit ranking by rating) ---
  if (/bäst.*(först|betygsatt|rankad)|mest hyllade|högst betyg|högst rankad|de bästa|bästa\b|de mest|topplista|topp ?\d/.test(q)) out.sortBy = 'vote_average.desc';

  // --- genreIds (lexicon; action/sci-fi depend on media type) ---
  const g = new Set<number>();
  if (/deckare|krim|kriminal|\bnoir\b|crime|\bpolis|gangster|maffia|mafia/.test(q)) g.add(80);
  if (/skräck|läskig|läbbig|rysare|zombie|spök|slasher|splatter|creepy/.test(q)) g.add(27);
  if (/komedi|komik|\bstand.?up|romcom|rom-com/.test(q)) g.add(35);
  if (/\bdram|biopic|biografi/.test(q)) g.add(18); // drama, dramaserie, dramatisk, biopic
  if (/thriller|spion|\bspy\b|agentfilm/.test(q)) g.add(53);
  if (/mysterium|mystik|whodunit/.test(q)) g.add(9648);
  if (/romanti|kärleksfilm|kärlekshistoria|kärlek\b|love story|\bromance\b/.test(q)) g.add(10749);
  if (/dokumentär|dokumentar|documentary|\bdoku\b/.test(q)) g.add(99);
  if (/western|västern/.test(q)) g.add(37);
  if (/fantasy|sagofilm|trollkarl/.test(q)) g.add(14);
  if (/animer|anime|tecknad|tecknat|animation/.test(q)) g.add(16);
  if (/famil|barn/.test(q)) g.add(10751);
  if (/\bhistori|kostymdrama|perioddrama/.test(q)) g.add(36); // historia/historisk, not kärlekshistoria
  if (/krig|världskriget/.test(q)) g.add(10752);
  if (/äventyr/.test(q) && !/actionäventyr/.test(q)) g.add(12); // "actionäventyr" is one concept (10759)
  if (/musik|musikal|musical/.test(q)) g.add(10402);
  if (/action|kampsport|superhjälte|superhero/.test(q)) g.add(out.mediaType === 'tv' ? 10759 : 28);
  if (/science fiction|sci.?fi|\brymd|dystop|apokalyp|cyberpunk|tidsres|utomjording|\baliens?\b/.test(q)) g.add(out.mediaType === 'tv' ? 10765 : 878);
  if (g.size) out.genreIds = [...g];

  // --- mood (feeling words; 'spanning' suppressed when an action/thriller/crime/
  //     adventure/mystery genre is already named, since "spännande"≈those genres) ---
  let mood: AskMood | null = null;
  if (/mysig|feelgood|feel.?good|\bmys\b|gosig|cozy|hjärtevärm|värmande/.test(q)) mood = 'mysig';
  else if (/skratta|skratt\b|\bfunny\b|\brolig|hilarious|tokrolig/.test(q)) mood = 'skratta';
  else if (/tänkvärd|tankvärd|gripande|reflekter|eftertänksam|meningsfull/.test(q)) mood = 'tankvard';
  else if (/spänning|spännande|nervkittlande|nagelbitare|pirrig|adrenalin|pulshöj|intensiv/.test(q)) mood = 'spanning';
  if (mood === 'spanning' && out.genreIds && out.genreIds.some((id) => ACTIONISH.includes(id))) mood = null;
  if (mood) out.mood = mood;

  return out;
}

/** True when the parser extracted essentially nothing — the signal to try an LLM fallback. */
export function isLowConfidence(filter: AskFilter): boolean {
  return Object.keys(filter).length === 0;
}
