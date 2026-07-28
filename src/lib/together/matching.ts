import type {
  AggregationStrategy,
  SessionCandidate,
  SessionParticipant,
  SessionSwipe,
  TasteVector,
  VoteKind,
} from '@/types';
import { scoreCandidateForUser } from '@/lib/taste/similarity';
import { mediaTypeDocId } from '@/lib/mediaTypeDocId';

/**
 * The one key a candidate is identified by across the whole Tillsammans
 * surface — swipe-dokumentets id, React-nycklar och per-kandidat-state.
 * Bara tmdbId räcker inte: film 42 och serie 42 är olika titlar och delade
 * annars röstsammanräkning. (BIN-569)
 */
export function candidateKey(candidate: { tmdbId: number; mediaType: string | null }): string {
  return mediaTypeDocId(candidate.mediaType, candidate.tmdbId);
}

/** Slår upp röstmapen för en kandidat, oavsett om dess swipe-doc är namngivet eller legacy. */
export type SwipeLookup = (candidate: { tmdbId: number; mediaType: string | null }) => Record<string, VoteKind>;

/**
 * Bygger uppslagningen en gång per render istället för en Map per anropare.
 * Ett namngivet dokument (`movie_42`) vinner alltid över ett legacy-dokument
 * på bara numret — legacy används bara som fallback så att en session som
 * pågick under övergången inte ser ut att tappa sina röster mitt i veckan.
 */
export function indexSwipes(swipes: SessionSwipe[]): SwipeLookup {
  const byKey = new Map<string, SessionSwipe>();
  const legacyByTmdbId = new Map<number, SessionSwipe>();
  for (const s of swipes) {
    if (s.mediaType) byKey.set(candidateKey(s), s);
    else legacyByTmdbId.set(s.tmdbId, s);
  }
  return candidate =>
    byKey.get(candidateKey(candidate))?.votes
    ?? legacyByTmdbId.get(candidate.tmdbId)?.votes
    ?? {};
}

export interface CandidateResult {
  candidate: SessionCandidate;
  votes: Record<string, VoteKind>;
  yesCount: number;
  noCount: number;
  vetoed: boolean;
  score: number;
  tasteScore: number;
  allVoted: boolean;
  missing: string[];
}

// Aggregeringsstrategier (Fas 3) — smak-scores modulerar vote-baserad score.
//
// - least_misery: straffar oenighet hårt, föredrar min-smak (ingen ska hata)
// - average: belönar brett gillande (summan av smak-scores)
// - fair: enstaka topp-pick får slå igenom (max-smak)
//
// Om smakvektorer saknas för deltagare (t.ex. gäster) blir taste-bidraget 0
// och vi faller tillbaka till klassisk vote-scoring (yes − no × 0.5).
// Vi använder INTE assertNever här — AggregationStrategy persisteras i
// Firestore (groups/{id}.defaults.aggregation + sessions/{id}.config.aggregation)
// och en legacy- eller hand-editerad doc med okänd sträng skulle krasha
// hela scoring:en. Graceful fallthrough till 'average' är säkrare.
function aggregateTaste(
  scores: number[],
  strategy: AggregationStrategy,
): number {
  if (scores.length === 0) return 0;
  switch (strategy) {
    case 'least_misery': return Math.min(...scores);
    case 'fair': return Math.max(...scores);
    case 'average':
    default:
      return scores.reduce((s, x) => s + x, 0) / scores.length;
  }
}

function votePenalty(strategy: AggregationStrategy): number {
  switch (strategy) {
    case 'least_misery': return 0.7;
    case 'fair': return 0.3;
    case 'average':
    default: return 0.5;
  }
}

export function scoreCandidates(params: {
  candidates: SessionCandidate[];
  participants: SessionParticipant[];
  swipes: SessionSwipe[];
  tasteByPid?: Map<string, TasteVector>;
  aggregation?: AggregationStrategy;
}): CandidateResult[] {
  const { candidates, participants, swipes, tasteByPid, aggregation = 'least_misery' } = params;
  const votesFor = indexSwipes(swipes);
  const pids = participants.map(p => p.id);
  const penalty = votePenalty(aggregation);

  return candidates.map(c => {
    const votes = votesFor(c);
    let yes = 0, no = 0, veto = false;
    for (const pid of pids) {
      const v = votes[pid];
      if (v === 'yes') yes++;
      else if (v === 'no') no++;
      else if (v === 'veto') veto = true;
    }
    const missing = pids.filter(pid => !votes[pid]);

    const tasteScores: number[] = [];
    if (tasteByPid) {
      for (const p of participants) {
        const tv = tasteByPid.get(p.id);
        if (tv) tasteScores.push(scoreCandidateForUser(c.genreIds, tv));
      }
    }
    const tasteScore = aggregateTaste(tasteScores, aggregation);

    const voteScore = yes - no * penalty;
    const score = veto ? -Infinity : voteScore + tasteScore;

    return {
      candidate: c,
      votes,
      yesCount: yes,
      noCount: no,
      vetoed: veto,
      score,
      tasteScore,
      allVoted: missing.length === 0,
      missing,
    };
  });
}

export function pickMatches(results: CandidateResult[], participantCount: number): CandidateResult[] {
  return results
    .filter(r => !r.vetoed)
    .filter(r => r.allVoted || r.yesCount >= Math.ceil(participantCount / 2))
    .filter(r => r.yesCount * 2 >= participantCount) // minst 50% ja
    .sort((a, b) => b.score - a.score || b.candidate.voteAverage - a.candidate.voteAverage)
    .slice(0, 10);
}

export function nextCandidate(params: {
  candidates: SessionCandidate[];
  swipes: SessionSwipe[];
  participantId: string;
}): SessionCandidate | null {
  const votesFor = indexSwipes(params.swipes);
  return params.candidates.find(c => !votesFor(c)[params.participantId]) ?? null;
}

export function participantSwipeProgress(
  swipes: SessionSwipe[],
  candidates: SessionCandidate[],
  participantId: string,
): { done: number; total: number } {
  const votesFor = indexSwipes(swipes);
  let done = 0;
  for (const c of candidates) {
    if (votesFor(c)[participantId]) done++;
  }
  return { done, total: candidates.length };
}
