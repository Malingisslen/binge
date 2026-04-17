import type { SessionCandidate, SessionParticipant, SessionSwipe, VoteKind } from '@/types';

export interface CandidateResult {
  candidate: SessionCandidate;
  votes: Record<string, VoteKind>;
  yesCount: number;
  noCount: number;
  vetoed: boolean;
  score: number;
  allVoted: boolean;
  missing: string[];
}

export function scoreCandidates(params: {
  candidates: SessionCandidate[];
  participants: SessionParticipant[];
  swipes: SessionSwipe[];
}): CandidateResult[] {
  const { candidates, participants, swipes } = params;
  const swipeMap = new Map(swipes.map(s => [s.tmdbId, s]));
  const pids = participants.map(p => p.id);

  return candidates.map(c => {
    const votes = swipeMap.get(c.tmdbId)?.votes ?? {};
    let yes = 0, no = 0, veto = false;
    for (const pid of pids) {
      const v = votes[pid];
      if (v === 'yes') yes++;
      else if (v === 'no') no++;
      else if (v === 'veto') veto = true;
    }
    const missing = pids.filter(pid => !votes[pid]);
    return {
      candidate: c,
      votes,
      yesCount: yes,
      noCount: no,
      vetoed: veto,
      score: veto ? -Infinity : yes - no * 0.5,
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
  const voted = new Set(
    params.swipes
      .filter(s => s.votes[params.participantId])
      .map(s => s.tmdbId),
  );
  return params.candidates.find(c => !voted.has(c.tmdbId)) ?? null;
}

export function participantSwipeProgress(
  swipes: SessionSwipe[],
  candidates: SessionCandidate[],
  participantId: string,
): { done: number; total: number } {
  let done = 0;
  for (const c of candidates) {
    const swipe = swipes.find(s => s.tmdbId === c.tmdbId);
    if (swipe?.votes[participantId]) done++;
  }
  return { done, total: candidates.length };
}
