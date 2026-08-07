import type { CascadeInput, RowSpec, Seed, RowId } from '@/types';
import { rowKey } from '@/types';

const B_KINDS = new Set<RowId['kind']>(['similar', 'person', 'latest-fav', 'upcoming']);
const JTBD_SORT_PRIORITY: Record<RowSpec['jtbd'], number> = { B: 0, C: 1 };

/**
 * BIN-583 — flat, constant score for the companion row, deliberately in the C
 * band between trending (30) and genre-canon (40).
 *
 * Binding condition from the #28 (Recommendations / Scoring-Integrity) critique:
 * membership in a hand-curated set is BINARY, not a strength signal, so there is
 * nothing to scale a score by. A hand-picked "high because it feels personal"
 * number would be an unvalidatable claim — the cascade has no per-row engagement
 * telemetry to check it against. Constant, mid-C, and easy to move later.
 *
 * ACCEPTED COST of that placement (second #28 condition, 2026-08-06): the hub
 * excludes every companion film from every OTHER row, so a film that would also
 * have qualified organically — the person row scores up to 90, free-public 55,
 * upcoming 50 — is pulled out of that higher row and shown here at 35 instead.
 * The title is never lost, only re-labelled and positioned lower, and it lands in
 * the row that explains WHY it is being offered, which is the point of the
 * feature. Revisit if per-row engagement telemetry ever exists to price it.
 */
const COMPANION_SCORE = 35;

/** "A", "A och B", "A, B och C" — Swedish list join for the row's standfirst. */
function joinSv(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} och ${names[names.length - 1]}`;
}

function jtbdOf(kind: RowId['kind']): RowSpec['jtbd'] {
  return B_KINDS.has(kind) ? 'B' : 'C';
}

function sortSeedsForSimilarRow(seeds: readonly Seed[]): Seed[] {
  return [...seeds].sort((a, b) => {
    if (b.rating !== a.rating) return b.rating - a.rating;
    const at = a.ratedAt?.getTime() ?? 0;
    const bt = b.ratedAt?.getTime() ?? 0;
    return bt - at;
  });
}

export function prioritizeRows(input: CascadeInput): RowSpec[] {
  const out: RowSpec[] = [];

  // Row 9 — latest 5★
  if (input.latestFiveStar) {
    const f = input.latestFiveStar;
    const score = Math.max(0, 100 - f.daysSince);
    out.push({
      id: { kind: 'latest-fav' },
      rowKey: rowKey({ kind: 'latest-fav' }),
      // R4: "(21 dagar sedan)" var kryptiskt — säg vad som hände istället.
      label: `Liknar ${f.title} — din senaste 5★`,
      score,
      jtbd: jtbdOf('latest-fav'),
    });
  }

  // Row 2 — recurring people
  for (const p of input.recurringPeople) {
    const score = Math.min(p.recurrence * 15, 90);
    out.push({
      id: { kind: 'person', personId: p.id },
      rowKey: rowKey({ kind: 'person', personId: p.id }),
      label: p.knownFor === 'director' ? `Mer från ${p.name}` : `Med ${p.name}`,
      score,
      jtbd: jtbdOf('person'),
      meta: { person: p },
    });
  }

  // Row 1 — similar to top-3 strong seeds. Exclude the latest-5★ seed: it already
  // owns the dedicated latest-fav row above, so a 'similar' row for the same
  // tmdbId+mediaType would be a duplicate "Liknar X"-rad (BIN-106).
  const fav = input.latestFiveStar;
  const topSeeds = sortSeedsForSimilarRow(input.strongSeeds)
    .filter(s => !(fav && s.tmdbId === fav.tmdbId && s.mediaType === fav.mediaType))
    .slice(0, 3);
  for (let i = 0; i < topSeeds.length; i++) {
    const s = topSeeds[i];
    const score = Math.min((topSeeds.length - i) * 12, 80);
    out.push({
      id: { kind: 'similar', mediaType: s.mediaType, tmdbId: s.tmdbId },
      rowKey: rowKey({ kind: 'similar', mediaType: s.mediaType, tmdbId: s.tmdbId }),
      // R2: seed-titeln i rubriken — "Liknar dina 5★" gav identiska rubriker
      // när flera seeds hade samma betyg.
      label: `Liknar ${s.title}`,
      score,
      jtbd: jtbdOf('similar'),
      meta: { seed: s },
    });
  }

  // Row 4 — recurring keywords
  for (const k of input.recurringKeywords) {
    const score = Math.min(k.recurrence * 10, 70);
    out.push({
      id: { kind: 'thematic', keywordId: k.id },
      rowKey: rowKey({ kind: 'thematic', keywordId: k.id }),
      label: `Tematiskt: ${k.name}`,
      score,
      jtbd: jtbdOf('thematic'),
      meta: { keyword: k },
    });
  }

  // Row 10 — upcoming (requires providers)
  if (input.hasMyProviders && input.upcomingCount > 0) {
    const score = Math.min(input.upcomingCount * 4, 50);
    out.push({
      id: { kind: 'upcoming' },
      rowKey: rowKey({ kind: 'upcoming' }),
      label: 'Kommande premiärer på dina tjänster',
      score,
      jtbd: jtbdOf('upcoming'),
    });
  }

  // Row 3 — genre canon
  if (input.dominantGenres.length > 0) {
    out.push({
      id: { kind: 'genre-canon', genreId: input.dominantGenres[0].id },
      rowKey: rowKey({ kind: 'genre-canon', genreId: input.dominantGenres[0].id }),
      label: 'Klassiker i dina genrer du missat',
      score: 40,
      jtbd: jtbdOf('genre-canon'),
      meta: { genre: { id: input.dominantGenres[0].id } },
    });
  }

  // BIN-175 — free public-service lane (always). Score 55 = free-first within
  // discovery: above the generic rows (genre-canon 40, trending 30, upcoming
  // ≤50). Strongly-scored personalised rows (a recent latest-fav, recurring
  // people, top seeds) still outrank it; weakly-scored ones may fall below it —
  // intended. Renders nothing when empty (RecRow drops empty rows), so a user
  // with no SVT matches loses nothing.
  out.push({
    id: { kind: 'free-public' },
    rowKey: rowKey({ kind: 'free-public' }),
    label: 'Gratis just nu på SVT Play',
    score: 55,
    jtbd: jtbdOf('free-public'),
  });

  // BIN-583 — "Fortsätter som film". Emitted ONLY when the curated map actually
  // has an unwatched follow-up film for a show the user follows. Malin's call
  // 2026-08-06: a row that shows up seldom and is right beats one that always
  // shows up and guesses — so there is no always-on lane here, unlike free-public.
  if (input.companionAnchors.length > 0) {
    out.push({
      id: { kind: 'companion' },
      rowKey: rowKey({ kind: 'companion' }),
      label: 'Fortsätter som film',
      description: `Eftersom du följer ${joinSv(input.companionAnchors.map(a => a.showTitle))}.`,
      score: COMPANION_SCORE,
      jtbd: jtbdOf('companion'),
      meta: { companions: [...input.companionAnchors] },
    });
  }

  // Row 6 — trending (always)
  out.push({
    id: { kind: 'trending' },
    rowKey: rowKey({ kind: 'trending' }),
    label: 'Trendar i Sverige denna vecka',
    score: 30,
    jtbd: jtbdOf('trending'),
  });

  // Sort by score desc; B-job tie-breaks before C-job; then rowKey for determinism
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.jtbd !== b.jtbd) return JTBD_SORT_PRIORITY[a.jtbd] - JTBD_SORT_PRIORITY[b.jtbd];
    return a.rowKey.localeCompare(b.rowKey);
  });

  return out;
}
