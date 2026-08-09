/**
 * Frö-urval: de sidor Google FAKTISKT hade i sitt index när BIN-823 upptäcktes.
 *
 * Skrapade ur Search Console 2026-08-08 ("Indexerade sidor", 117 rader: 74
 * filmer, 32 personer, 10 serier + startsidan). Vid tillfället svarade 16 av 20
 * stickprov ur just den listan `noindex` — de hade ramlat ur det roterande
 * pre-render-urvalet och var på väg ut ur indexet vid Googles nästa besök.
 *
 * Därför finns filen: de här id:na unioneras in i urvalet vid LÄSNING
 * (selectionManifest.resolvedIds) och lagras aldrig i det evakuerbara
 * manifestet. De kan alltså inte falla ur när taket tvingar fram evakuering,
 * och de överlever ett raderat eller korrupt manifest — även en helt kall
 * actions/cache. Det som redan är indexerat ska aldrig kunna sluta byggas.
 *
 * De räknas UTANFÖR taket (#3 Financial Controllers villkor 4): det upplösta
 * urvalet kan bli upp till SELECTION_CEILING + antalet frön. Räkna på den basen
 * vid en framtida takhöjning.
 *
 * Sidorna var senast genomsökta av Google 21–28 april 2026 (startsidan 4 aug).
 * Listan är alltså ett fotografi av ett index som redan höll på att vittra —
 * den ska INTE utökas löpande. Nya sidor kommer in via den normala veckovisa
 * härledningen; det här är en engångsräddning av det som fanns kvar.
 *
 * Om proveniens och döda id:n: listan kommer ur Googles egna index, alltså
 * sidor binge.nu vid något tillfälle serverade med riktig metadata — varje id
 * har alltså svarat på TMDB. De är INTE omvaliderade mot TMDB inför den här
 * committen (kräver API-nyckeln, se BIN-823).
 *
 * Ett id som TMDB sedan tagit bort blir inte en soft-404: `generateMetadata` i
 * {movie,tv,person}/[id] fångar redan en misslyckad byggtidshämtning och svarar
 * `noindex, follow` med SELF-canonical — uttryckligen för att aldrig skicka en
 * indexerbar sida med root-layoutens titel och `canonical:/`. Kostnaden för ett
 * dött frö-id är därför en bortkastad byggplats, inte en dubblettsida. Det är
 * varför omvalidering är en uppföljning och inte en blockerare.
 */

export const SEED_MOVIE_IDS: readonly number[] = [
  492253, 581810, 299295, 134429, 237202, 1015953, 1322699, 86851, 1376821,
  1519426, 337883, 597782, 235408, 483126, 774531, 558095, 323435, 819513,
  558354, 1204360, 452130, 90737, 1388244, 283227, 723858, 578837, 218568,
  360435, 392625, 14892, 608009, 47813, 361240, 1149391, 149239, 686417,
  52862, 367540, 915582, 135594, 563566, 354923, 247924, 55723, 468376,
  1104648, 56168, 669468, 617676, 11197, 285983, 1060070, 26440, 614463,
  610514, 242471, 775923, 1527784, 1641030, 922924, 541639, 191995, 280525,
  78531, 41164, 307201, 174943, 129072, 520625, 1508503, 559052, 192293,
  111066, 407685,
];

export const SEED_TV_IDS: readonly number[] = [
  64978, 60622, 128, 93287, 1398, 14575, 75006, 69541, 83178, 203744,
];

export const SEED_PERSON_IDS: readonly number[] = [
  166054, 2170014, 3405920, 69592, 1084581, 1264715, 3068023, 1120182,
  1158458, 2123842, 543163, 3251939, 21415, 1634770, 1403207, 3375425,
  56251, 1904394, 1108276, 48851, 1956484, 2006898, 3325993, 5170738,
  1299781, 2602279, 1467429, 172490, 32049, 245573, 165742, 591475,
];
