/**
 * Deterministic Swedish "content floor" for pre-rendered title pages.
 *
 * Why this exists (SEO / GSC 2026-07-03): ~72% of TV and ~29% of film pages
 * shipped with an empty TMDB overview, so their only unique text was
 * "Titel (år).". Google parks such thin, templated pages in "Crawled –
 * currently not indexed". This helper manufactures one honest, Swedish,
 * per-title sentence pair from fields we already fetch at build time — leaning
 * on Binge's wedge: *where can I stream this in Sweden, and can I rent it?*
 *
 * Two stakeholder reviews shaped this (both APPROVE-WITH-CONDITIONS, folded in):
 *  - Growth Marketer #15: a single fixed sentence grammar across 25k pages is a
 *    doorway-page fingerprint → the descriptive sentence rotates through THREE
 *    structurally distinct templates, chosen deterministically by tmdbId
 *    (stable per title → reproducible builds; Math.random is banned in build
 *    code anyway).
 *  - Content Strategist #17: (a) compound the genre naturally into the noun
 *    ("en science fiction-film", "en dramaserie") instead of the machine-y
 *    "i genren X"; keyed by stable genre id, not fragile strings. (b) the meta
 *    description must LEAD with availability so the wedge survives the 170-char
 *    cut. (c) flatter register — "X streamas just nu på Y" not "Just nu kan du
 *    streama X på Y" (voice-and-tone rule: state facts, not feelings).
 *
 * Honesty rule: every asserted fact comes from the input. Availability is only
 * ever claimed from the providers actually passed in.
 *
 * Pure + framework-free on purpose: unit-testable without Firebase/Next.
 */

export interface ContentFloorInput {
  id: number;
  kind: 'movie' | 'tv';
  title: string;
  /** Four-digit year as string, or null when unknown. */
  year: string | null;
  /** TMDB genre ids (stable across locales). */
  genreIds: number[];
  /** Movie runtime in minutes. */
  runtimeMin?: number | null;
  /** TV season count. */
  seasons?: number | null;
  /** Top-billed cast names (already ordered). */
  cast: string[];
  /** Swedish provider display names, split by tier. */
  providers: { stream: string[]; rent: string[]; buy: string[] };
  /** TMDB overview (may be empty for obscure titles). */
  overview?: string | null;
}

export interface ContentFloor {
  /** For <meta name="description"> — real overview when good, else generated. */
  description: string;
  /** Visible crawlable Swedish prose baked into the static body. */
  paragraph: string;
}

const META_MAX = 170;
const PROVIDER_CAP = 3;
const CAST_CAP = 2;
const MIN_REAL_OVERVIEW = 60;
const MIN_REAL_BIO = 60;

/**
 * Natural Swedish noun phrase per TMDB genre id, for film and for serie.
 * The head noun is always an "en"-word (film/serie) so grammatical gender is
 * never a problem; adjective genres (animerad/historisk/romantisk) keep the
 * "en" article too. Non-narrative genres (Nyheter/Talkshow) are left blank so
 * the caller falls back to a bare "en film/serie". Ids from genreLabels.ts.
 */
const GENRE_PHRASE: Record<number, { f?: string; s?: string }> = {
  28: { f: 'en actionfilm', s: 'en actionserie' },
  12: { f: 'en äventyrsfilm', s: 'en äventyrsserie' },
  16: { f: 'en animerad film', s: 'en animerad serie' },
  35: { f: 'en komedifilm', s: 'en komediserie' },
  80: { f: 'en kriminalfilm', s: 'en kriminalserie' },
  99: { f: 'en dokumentärfilm', s: 'en dokumentärserie' },
  18: { f: 'en dramafilm', s: 'en dramaserie' },
  10751: { f: 'en familjefilm', s: 'en familjeserie' },
  14: { f: 'en fantasyfilm', s: 'en fantasyserie' },
  36: { f: 'en historisk film', s: 'en historisk serie' },
  27: { f: 'en skräckfilm', s: 'en skräckserie' },
  10402: { f: 'en musikfilm', s: 'en musikserie' },
  9648: { f: 'en mysteriefilm', s: 'en mysterieserie' },
  10749: { f: 'en romantisk film', s: 'en romantisk serie' },
  878: { f: 'en science fiction-film', s: 'en science fiction-serie' },
  10770: { f: 'en TV-film' },
  53: { f: 'en thrillerfilm', s: 'en thrillerserie' },
  10752: { f: 'en krigsfilm', s: 'en krigsserie' },
  37: { f: 'en westernfilm', s: 'en westernserie' },
  10759: { f: 'en actionfilm', s: 'en actionserie' }, // Action & Äventyr (tv)
  10762: { f: 'en barnfilm', s: 'en barnserie' },
  10763: {}, // Nyheter → drop
  10764: { s: 'en realityserie' },
  10765: { f: 'en science fiction-film', s: 'en science fiction-serie' }, // Sci-Fi & Fantasy
  10766: { s: 'en såpa' },
  10767: {}, // Talkshow → drop
  10768: { s: 'en serie om krig och politik' }, // Krig & Politik
};

/** Swedish natural-language list join: "A", "A och B", "A, B och C". */
function joinSv(names: string[]): string {
  if (names.length === 1) return names[0];
  const head = names.slice(0, -1).join(', ');
  return `${head} och ${names[names.length - 1]}`;
}

/** Cap a provider list to keep it from reading as keyword stuffing. */
function providerPhrase(names: string[]): string {
  if (names.length <= PROVIDER_CAP) return joinSv(names);
  return `${names.slice(0, PROVIDER_CAP).join(', ')} m.fl.`;
}

/** First genre with a phrase for this medium; else a bare noun. */
function genrePhrase(input: ContentFloorInput): string {
  for (const id of input.genreIds) {
    const phrase = input.kind === 'movie' ? GENRE_PHRASE[id]?.f : GENRE_PHRASE[id]?.s;
    if (phrase) return phrase;
  }
  return input.kind === 'movie' ? 'en film' : 'en serie';
}

/** Title-first availability line — used for the body and to lead the meta. */
function availabilityLead(input: ContentFloorInput): string {
  const { title, providers } = input;
  if (providers.stream.length > 0) {
    return `${title} streamas just nu på ${providerPhrase(providers.stream)} i Sverige.`;
  }
  const rentBuy = Array.from(new Set([...providers.rent, ...providers.buy]));
  if (rentBuy.length > 0) {
    return `${title} går att hyra eller köpa digitalt i Sverige, till exempel via ${providerPhrase(rentBuy)}.`;
  }
  return `${title} finns ännu inte på någon streamingtjänst i Sverige.`;
}

function capFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Length clause ("148 min" / "8 säsonger"), or null when unknown. */
function lengthWords(input: ContentFloorInput): string | null {
  if (input.kind === 'movie') {
    return input.runtimeMin ? `${input.runtimeMin} min` : null;
  }
  if (!input.seasons) return null;
  return input.seasons === 1 ? '1 säsong' : `${input.seasons} säsonger`;
}

/** Three structurally distinct descriptive templates, chosen by tmdbId. */
function descriptiveSentence(input: ContentFloorInput): string {
  const { title, year } = input;
  const gp = genrePhrase(input);
  const yearParen = year ? ` (${year})` : '';
  const castJoined = input.cast.length ? joinSv(input.cast.slice(0, CAST_CAP)) : null;
  const len = lengthWords(input);
  const isMovie = input.kind === 'movie';

  const parts: string[] = [];
  switch (input.id % 3) {
    case 0: {
      parts.push(`${title}${yearParen} är ${gp}.`);
      if (castJoined) parts.push(`I rollerna: ${castJoined}.`);
      if (len) parts.push(isMovie ? `Speltid: ${len}.` : `Omfattar ${len}.`);
      break;
    }
    case 1: {
      parts.push(year ? `${capFirst(gp)} från ${year}: ${title}.` : `${capFirst(gp)}: ${title}.`);
      if (castJoined) parts.push(`Med ${castJoined}.`);
      if (len) parts.push(isMovie ? `Längd ${len}.` : `${capFirst(len)}.`);
      break;
    }
    default: {
      const premiere = year ? ` med premiär ${year}` : '';
      parts.push(`${title} är ${gp}${premiere}.`);
      if (castJoined) parts.push(`${castJoined} medverkar.`);
      if (len) parts.push(isMovie ? `Filmen är ${len} lång.` : `Serien har ${len}.`);
      break;
    }
  }
  return parts.join(' ');
}

/** Title-less genre/year/cast tail for the meta description. */
function metaTail(input: ContentFloorInput): string {
  const gp = capFirst(genrePhrase(input));
  const year = input.year ? ` (${input.year})` : '';
  const castJoined = input.cast.length ? ` med ${joinSv(input.cast.slice(0, CAST_CAP))}` : '';
  return `${gp}${year}${castJoined}.`;
}

function truncateForMeta(s: string): string {
  if (s.length <= META_MAX) return s;
  const cut = s.slice(0, META_MAX - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const body = lastSpace > 60 ? cut.slice(0, lastSpace) : cut;
  return `${body.trimEnd()}…`;
}

export function buildContentFloor(input: ContentFloorInput): ContentFloor {
  const paragraph = `${descriptiveSentence(input)} ${availabilityLead(input)}`;

  const overview = input.overview?.trim() ?? '';
  const description =
    overview.length >= MIN_REAL_OVERVIEW
      ? truncateForMeta(overview)
      : truncateForMeta(`${availabilityLead(input)} ${metaTail(input)}`);

  return { description, paragraph };
}

export interface PersonDescriptionInput {
  name: string;
  /**
   * TMDB's sv-SE biography ONLY. Two sources the page body does show must never
   * be passed here:
   *   - the svenska-Wikipedia bio — it is CC BY-SA and must carry attribution
   *     wherever it travels. The body renders a "Biografi från …"-credit link;
   *     a <meta> description, and the search snippet cut from it, cannot (BIN-686).
   *   - TMDB's English bio — the body labels it "Biografi på engelska", and a
   *     SERP snippet carries no such label.
   * Either one absent here just means the generated Swedish line is used instead,
   * which is still unique per person.
   */
  biography?: string | null;
  /** Already-translated Swedish department label ("Skådespelare"), or null. */
  role?: string | null;
  /** Four-digit birth year as string, or null when unknown. */
  birthYear?: string | null;
  birthPlace?: string | null;
}

/**
 * Per-person meta description — the same content-floor idea as titles (BIN-656).
 *
 * Person pages used to ship one sentence with only the name swapped in, so every
 * long-tail /person page was a near-duplicate meta description. A real Swedish
 * bio is used when there is one; otherwise the facts we already have (role,
 * birth year, birthplace) make the line unique per person.
 *
 * Unlike titles this does NOT lead with availability: a person has no Swedish
 * streaming availability of their own, and the searched-for term is the name,
 * so the name must survive the 170-char cut. Every asserted fact comes from the
 * input — nothing is invented.
 */
export function buildPersonDescription(input: PersonDescriptionInput): string {
  // TMDB/Wikipedia bios carry hard line breaks; a snippet is one line.
  const bio = (input.biography ?? '').replace(/\s+/g, ' ').trim();
  if (bio.length >= MIN_REAL_BIO) return truncateForMeta(bio);

  const { name, role, birthYear, birthPlace } = input;
  // Parenthesised label sidesteps Swedish noun agreement: "(Skådespelare)" and
  // the department-shaped labels ("(Regi)", "(Manus)") both read correctly.
  const roleParen = role ? ` (${role})` : '';
  let born = '';
  if (birthYear && birthPlace) born = `, född ${birthYear} i ${birthPlace}`;
  else if (birthYear) born = `, född ${birthYear}`;
  else if (birthPlace) born = `, från ${birthPlace}`;

  return truncateForMeta(`${name}${roleParen}${born}. Filmografi och var titlarna streamas i Sverige.`);
}
