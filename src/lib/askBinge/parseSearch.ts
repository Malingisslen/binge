// BIN-176 — deterministic natural-language → AskFilter parser.
//
// The production version of the parser proven in scripts/askbinge-eval/ (98.5% strict
// on the gold set, vs Gemini 31–65%). The filter dimensions are overwhelmingly
// keyword-driven, so plain rules beat an LLM here — for free, instantly, with no
// hallucinated filters. The genuinely fuzzy residual (similes, slang) is left for a
// future LLM fallback; `parseSearch` returning an (almost) empty filter is the signal
// that the fallback should run.
//
// KEEP IN SYNC with scripts/askbinge-eval/deterministic.mjs (the eval harness mirror).

import type { AskFilter, AskMood } from './types';

const ACTIONISH = [28, 10759, 53, 80, 9648, 12];

export function parseSearch(raw: string): AskFilter {
  const q = raw.toLocaleLowerCase('sv');
  const out: AskFilter = {};

  // --- mediaType (substring so "skräckfilm"/"dramaserie" match) ---
  const isMovie = /film|movie/.test(q);
  const isTv = /serie|series|\bshow\b/.test(q);
  if (isMovie && !isTv) out.mediaType = 'movie';
  else if (isTv && !isMovie) out.mediaType = 'tv';

  // --- decade ---
  let decade: string | null = null;
  const four = q.match(/\b(19\d0|20\d0)[\s-]?tal/); // "2010-talet"
  if (four) decade = four[1];
  if (!decade) {
    const two = q.match(/\b(\d{2})[\s-]?tal/); // "80-talet"
    if (two) { const n = Number(two[1]); decade = n <= 20 ? String(2000 + n) : String(1900 + n); }
  }
  if (!decade) {
    const words: Record<string, string> = { sextiotal: '1960', sjuttiotal: '1970', åttiotal: '1980', nittiotal: '1990' };
    for (const w in words) if (q.includes(w)) { decade = words[w]; break; }
  }
  if (decade) out.decade = decade;

  // --- excludeSeen (no bare "nya" — "nya filmer" = new RELEASES, not unseen) ---
  if (/(inte sett|inte börjat|inte påbörjat|kan börja|jag inte sett|som jag inte|nytt för mig|något nytt|haven'?t started|haven'?t seen|haven'?t watched|not seen)/.test(q)) {
    out.excludeSeen = true;
  }

  // --- providerIds ("max" only as the service, not "max två timmar"/"max 30 min") ---
  const PROV: [RegExp, number][] = [
    [/netflix/, 8], [/viaplay/, 76], [/disney/, 337], [/\bhbo\b|hbo max|\bmax\b(?!\s*(?:\d|två|tva|tre|fyra|en\s|minut|min\b|timm))/, 384],
    [/svt/, 520], [/tv4/, 489], [/apple/, 350], [/paramount/, 531],
    [/discovery/, 510], [/skyshowtime/, 431], [/prime|amazon/, 119], [/crunchyroll/, 323],
  ];
  const pids: number[] = [];
  for (const [re, id] of PROV) if (re.test(q)) pids.push(id);
  if (pids.length) out.providerIds = [...new Set(pids)];

  // --- myProvidersOnly ---
  if (/(mina tjänster|det jag har|jag betalar|on my services|my services)/.test(q)) out.myProvidersOnly = true;

  // --- originalLanguage (\banime\b so "animerad" doesn't read as Japanese) ---
  const LANG: [RegExp, string][] = [
    [/svensk|nordisk|nordic/, 'sv'], [/dansk|danish/, 'da'], [/norsk|norwegian/, 'no'],
    [/koreansk|korean/, 'ko'], [/japansk|\banime\b/, 'ja'], [/fransk|french/, 'fr'],
    [/spansk|spanish/, 'es'], [/tysk|german/, 'de'], [/italiensk|italian/, 'it'],
    [/rysk|russian/, 'ru'], [/indisk|bollywood|indian/, 'hi'],
    // NB: no "engelsk → en" row — TMDB's with_original_language=en is ALL
    // English-language content (US/UK/AU), so it broadens instead of filtering.
  ];
  for (const [re, code] of LANG) if (re.test(q)) { out.originalLanguage = code; break; }

  // --- runtimeMax ---
  const mins = q.match(/(\d{2,3})\s*min/);
  if (mins) { const n = Number(mins[1]); out.runtimeMax = n <= 30 ? 30 : n <= 60 ? 60 : n <= 90 ? 90 : 120; }
  else if (/två timmar|2 timmar|tva timmar/.test(q)) out.runtimeMax = 120;
  else if (/\bkort\b|korta/.test(q)) out.runtimeMax = 30;
  else if (/någon timme|en timme|nån timme|på lunchen|innan jag somnar/.test(q)) out.runtimeMax = 60;

  // --- voteAverageMin (explicit quality words only; "bra" alone never counts) ---
  if (/riktigt bra|mest hyllade|prisbelön/.test(q)) out.voteAverageMin = 8;
  else if (/hyllad|hyllade|högt betyg|välrecenserad|high.?rated/.test(q)) out.voteAverageMin = 7.5;

  // --- sortBy (explicit ranking by rating) ---
  if (/bäst.*(först|betygsatt)|mest hyllade|högst betyg|de bästa|bästa\b|de mest/.test(q)) out.sortBy = 'vote_average.desc';

  // --- genreIds (lexicon; action/sci-fi depend on media type) ---
  const g = new Set<number>();
  if (/deckare|krim|kriminal|noir|crime/.test(q)) g.add(80);
  if (/skräck|läskig|rysare|zombie/.test(q)) g.add(27);
  if (/komedi/.test(q)) g.add(35);
  if (/\bdram/.test(q)) g.add(18); // drama, dramer, dramaserie, dramatisk
  if (/thriller/.test(q)) g.add(53);
  if (/mysterium|mystik/.test(q)) g.add(9648);
  if (/romanti|kärleksfilm|kärlekshistoria/.test(q)) g.add(10749);
  if (/dokumentär|documentary/.test(q)) g.add(99);
  if (/western|västern/.test(q)) g.add(37);
  if (/fantasy/.test(q)) g.add(14);
  if (/animer|anime|tecknad/.test(q)) g.add(16);
  if (/famil|barn/.test(q)) g.add(10751);
  if (/\bhistori/.test(q)) g.add(36); // word-start: "historia/historisk", not "kärlekshistoria"
  if (/krig/.test(q)) g.add(10752);
  if (/äventyr/.test(q) && !/actionäventyr/.test(q)) g.add(12); // "actionäventyr" is one concept (10759)
  if (/musik/.test(q)) g.add(10402);
  if (/action/.test(q)) g.add(out.mediaType === 'tv' ? 10759 : 28);
  if (/science fiction|sci-fi|scifi/.test(q)) g.add(out.mediaType === 'tv' ? 10765 : 878);
  if (g.size) out.genreIds = [...g];

  // --- mood (feeling words; 'spanning' suppressed when an action/thriller/crime/
  //     adventure/mystery genre is already named, since "spännande"≈those genres) ---
  let mood: AskMood | null = null;
  if (/mysig|feelgood|\bmys\b/.test(q)) mood = 'mysig';
  else if (/skratta|\bfunny\b/.test(q)) mood = 'skratta';
  else if (/tänkvärd|tankvärd/.test(q)) mood = 'tankvard';
  else if (/spänning|spännande|nervkittlande/.test(q)) mood = 'spanning';
  if (mood === 'spanning' && out.genreIds && out.genreIds.some((id) => ACTIONISH.includes(id))) mood = null;
  if (mood) out.mood = mood;

  return out;
}

/** True when the parser extracted essentially nothing — the signal to try an LLM fallback. */
export function isLowConfidence(filter: AskFilter): boolean {
  return Object.keys(filter).length === 0;
}
