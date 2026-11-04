import type { SessionCandidate, SessionParticipant, VoteKind } from '@/types';

/** Hur länge remsan "Veto lagt. Ångra veto" ligger kvar efter ett lagt veto. */
export const VETO_UNDO_STRIP_MS = 8000;

/**
 * En inloggad deltagare på sin egen plats (platsens id är hens uid). Reglerna
 * låter bara en sådan plats få tillbaka sitt veto; en anonym plats kan varken
 * ändra en lagd röst eller räkna upp vetot.
 */
export function isSignedInOwnSeat(me: Pick<SessionParticipant, 'id' | 'uid'>): boolean {
  return !!me.uid && me.id === me.uid;
}

/** Om knappen "Ångra veto" ska visas för en titel där jag har rösten `myVote`. */
export function canUndoVetoOn(
  me: Pick<SessionParticipant, 'id' | 'uid'>,
  myVote: VoteKind | undefined,
): boolean {
  return myVote === 'veto' && isSignedInOwnSeat(me);
}

/** Titeln jag har lagt veto på, eller null. Används för den kvarstående ångra-knappen. */
export function myVetoedCandidate(
  rows: ReadonlyArray<{ candidate: SessionCandidate; votes: Record<string, VoteKind> }>,
  participantId: string,
): SessionCandidate | null {
  return rows.find(r => r.votes[participantId] === 'veto')?.candidate ?? null;
}
