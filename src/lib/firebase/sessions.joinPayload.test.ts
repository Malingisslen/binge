import { describe, it, expect } from 'vitest';
import { planJoinFields } from './sessions.joinPayload';

describe('planJoinFields (BIN-540 rejoin/heal contract)', () => {
  it('first join (no slot) arms the veto budget', () => {
    expect(planJoinFields(null)).toEqual({ firstJoin: true, heal: {} });
  });

  it('rejoin of a valid spent slot touches NOTHING — the ratchet forbids re-arming', () => {
    // vetoRemaining 0 is a legitimate spent value; healing it would be denied.
    expect(planJoinFields({ vetoRemaining: 0, isHost: false })).toEqual({ firstJoin: false, heal: {} });
  });

  it('rejoin of a valid unspent slot also touches nothing', () => {
    expect(planJoinFields({ vetoRemaining: 1, isHost: true })).toEqual({ firstJoin: false, heal: {} });
  });

  it('heals a junk-typed vetoRemaining so the merged write passes the rule', () => {
    expect(planJoinFields({ vetoRemaining: 'many', isHost: false })).toEqual({
      firstJoin: false, heal: { vetoRemaining: 0 },
    });
  });

  it('heals a missing/junk isHost', () => {
    expect(planJoinFields({ vetoRemaining: 1, isHost: 'yes' })).toEqual({
      firstJoin: false, heal: { isHost: false },
    });
    expect(planJoinFields({ vetoRemaining: 1 })).toEqual({
      firstJoin: false, heal: { isHost: false },
    });
  });

  it('heals both fields when both are junk', () => {
    expect(planJoinFields({ vetoRemaining: null, isHost: 3 })).toEqual({
      firstJoin: false, heal: { vetoRemaining: 0, isHost: false },
    });
  });

  it('a non-integer numeric vetoRemaining is junk (only whole veto counts are valid)', () => {
    expect(planJoinFields({ vetoRemaining: 0.5, isHost: false }).heal).toEqual({ vetoRemaining: 0 });
  });

  it('a valid integer OUTSIDE [0,1] is healed too (planted 2 / -1 would else brick rejoin)', () => {
    expect(planJoinFields({ vetoRemaining: 2, isHost: false }).heal).toEqual({ vetoRemaining: 0 });
    expect(planJoinFields({ vetoRemaining: -1, isHost: false }).heal).toEqual({ vetoRemaining: 0 });
  });

  it('leaves the two legal stored values (0 and 1) untouched', () => {
    expect(planJoinFields({ vetoRemaining: 0, isHost: false }).heal).toEqual({});
    expect(planJoinFields({ vetoRemaining: 1, isHost: false }).heal).toEqual({});
  });
});
