// BIN-176 — deterministic (rule-based) pre-parser PROTOTYPE.
//
// Hypothesis: most of the query can be parsed in the app with plain rules — the
// dimensions that are keyword-driven (decade, exclude-seen, rating words, provider
// names, runtime, language, media type, named genres). That removes exactly the
// fields the LLM hallucinated or missed (voteAverageMin, excludeSeen, decade), and
// leaves only the fuzzy semantic part (mood / genre-from-simile) for a possible LLM
// fallback. No API, no key, no cost. Measured by `run.mjs --engine deterministic`.
//
// This is a prototype to size the approach against the gold set, NOT yet production.

function parse(qRaw) {
  const q = qRaw.toLocaleLowerCase('sv');
  const out = {};

  // --- mediaType (substring so "skräckfilm"/"dramaserie" match) ---
  const isMovie = /film|movie/.test(q);
  const isTv = /serie|series|\bshow\b/.test(q);
  if (isMovie && !isTv) out.mediaType = 'movie';
  else if (isTv && !isMovie) out.mediaType = 'tv';

  // --- decade ---
  let dm = q.match(/\b(19\d0|20\d0)[\s-]?tal/);          // "2010-talet"
  if (!dm) {
    const two = q.match(/\b(\d{2})[\s-]?tal/);            // "80-talet"
    if (two) { const n = Number(two[1]); dm = [, n <= 20 ? String(2000 + n) : String(1900 + n)]; }
  }
  if (!dm) {
    const words = { sextiotal: '1960', sjuttiotal: '1970', åttiotal: '1980', nittiotal: '1990' };
    for (const w in words) if (q.includes(w)) { dm = [, words[w]]; break; }
  }
  if (dm) out.decade = dm[1];

  // --- excludeSeen ---
  // NB: no bare "nya" — "visa nya filmer" means new RELEASES, not unseen-by-me.
  if (/(inte sett|inte börjat|inte påbörjat|kan börja|jag inte sett|som jag inte|nytt för mig|något nytt|haven'?t started|haven'?t seen|haven'?t watched|not seen)/.test(q)) {
    out.excludeSeen = true;
  }

  // --- providerIds ---
  const PROV = [
    // "max" only as the service — not "max två timmar" / "max 30 min" (maximum).
    [/netflix/, 8], [/viaplay/, 76], [/disney/, 337], [/\bhbo\b|hbo max|\bmax\b(?!\s*(?:\d|två|tva|tre|fyra|en\s|minut|min\b|timm))/, 384],
    [/svt/, 520], [/tv4/, 489], [/apple/, 350], [/paramount/, 531],
    [/discovery/, 510], [/skyshowtime/, 431], [/prime|amazon/, 119], [/crunchyroll/, 323],
  ];
  const pids = [];
  for (const [re, id] of PROV) if (re.test(q)) pids.push(id);
  if (pids.length) out.providerIds = [...new Set(pids)];

  // --- myProvidersOnly ---
  if (/(mina tjänster|det jag har|jag betalar|on my services|my services)/.test(q)) out.myProvidersOnly = true;

  // --- originalLanguage (\banime\b so "animerad"/"animation" don't match Japanese) ---
  const LANG = [[/svensk|nordisk|nordic/, 'sv'], [/dansk|danish/, 'da'], [/norsk|norwegian/, 'no'], [/koreansk|korean/, 'ko'], [/japansk|\banime\b/, 'ja'], [/fransk|french/, 'fr'], [/spansk|spanish/, 'es'], [/tysk|german/, 'de'], [/italiensk|italian/, 'it'], [/rysk|russian/, 'ru'], [/indisk|bollywood|indian/, 'hi']];
  for (const [re, code] of LANG) if (re.test(q)) { out.originalLanguage = code; break; }

  // --- runtimeMax ---
  const mins = q.match(/(\d{2,3})\s*min/);
  if (mins) { const n = Number(mins[1]); out.runtimeMax = n <= 30 ? 30 : n <= 60 ? 60 : n <= 90 ? 90 : 120; }
  else if (/två timmar|2 timmar|tva timmar/.test(q)) out.runtimeMax = 120;
  else if (/\bkort\b|korta/.test(q)) out.runtimeMax = 30;
  else if (/någon timme|en timme|nån timme|på lunchen|innan jag somnar/.test(q)) out.runtimeMax = 60;

  // --- voteAverageMin (only explicit quality words; "bra" alone never counts) ---
  if (/riktigt bra|mest hyllade|prisbelön/.test(q)) out.voteAverageMin = 8;
  else if (/hyllad|hyllade|högt betyg|välrecenserad|high.?rated/.test(q)) out.voteAverageMin = 7.5;

  // --- sortBy (explicit ranking by rating) ---
  if (/bäst.*(först|betygsatt)|mest hyllade|högst betyg|de bästa|bästa\b|de mest/.test(q)) out.sortBy = 'vote_average.desc';

  // --- genreIds (lexicon; action/sci-fi depend on media type) ---
  const g = new Set();
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

  // --- mood (feeling words; spanning suppressed when an action/thriller/crime/
  //     adventure/mystery genre is already named, since "spännande"≈those genres) ---
  const ACTIONISH = [28, 10759, 53, 80, 9648, 12];
  let mood = null;
  if (/mysig|feelgood|\bmys\b/.test(q)) mood = 'mysig'; // "lättsam" alone is too weak a mood signal
  else if (/skratta|\bfunny\b/.test(q)) mood = 'skratta';
  else if (/tänkvärd|tankvärd/.test(q)) mood = 'tankvard';
  else if (/spänning|spännande|nervkittlande/.test(q)) mood = 'spanning';
  if (mood === 'spanning' && out.genreIds && out.genreIds.some((id) => ACTIONISH.includes(id))) mood = null;
  if (mood) out.mood = mood;

  return out;
}

export const parseDeterministic = parse;
