import { describe, it, expect } from 'vitest';
import { isSignedInOwnSeat, canUndoVetoOn, myVetoedCandidate } from './vetoUndo';
import type { SessionCandidate, VoteKind } from '@/types';

type Row = { candidate: SessionCandidate; votes: Record<string, VoteKind> };

const cand = (tmdbId: number) => ({ tmdbId, mediaType: 'movie', title: `T${tmdbId}` }) as unknown as SessionCandidate;

describe('isSignedInOwnSeat', () => {
  it('är sann för en inloggad på sin egen plats', () => {
    expect(isSignedInOwnSeat({ id: 'u1', uid: 'u1' })).toBe(true);
  });
  it('är falsk för en anonym gäst', () => {
    expect(isSignedInOwnSeat({ id: 'tok', uid: null })).toBe(false);
  });
  it('är falsk för en plats vars id inte är uid (loggade in mitt i sessionen)', () => {
    expect(isSignedInOwnSeat({ id: 'tok', uid: 'u1' })).toBe(false);
  });
});

describe('canUndoVetoOn', () => {
  it('visar knappen när min röst är veto på egen inloggad plats', () => {
    expect(canUndoVetoOn({ id: 'u1', uid: 'u1' }, 'veto')).toBe(true);
  });
  it('visar ingen knapp när rösten inte är veto', () => {
    expect(canUndoVetoOn({ id: 'u1', uid: 'u1' }, 'no')).toBe(false);
    expect(canUndoVetoOn({ id: 'u1', uid: 'u1' }, undefined)).toBe(false);
  });
  it('visar ingen knapp för en anonym gäst', () => {
    expect(canUndoVetoOn({ id: 'tok', uid: null }, 'veto')).toBe(false);
  });
});

describe('myVetoedCandidate', () => {
  it('hittar titeln där jag lagt veto', () => {
    const rows: Row[] = [
      { candidate: cand(1), votes: { me: 'yes', other: 'veto' } },
      { candidate: cand(2), votes: { me: 'veto' } },
    ];
    expect(myVetoedCandidate(rows, 'me')?.tmdbId).toBe(2);
  });
  it('ger null när jag inte har något veto, även om någon annan har', () => {
    const rows: Row[] = [{ candidate: cand(1), votes: { other: 'veto' } }];
    expect(myVetoedCandidate(rows, 'me')).toBeNull();
  });
});
