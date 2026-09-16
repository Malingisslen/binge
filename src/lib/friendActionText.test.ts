import { describe, it, expect } from 'vitest';
import { FRIEND_FAILURE_TEXT, type FriendAction } from './friendActionText';

// The roster floor sits OUTSIDE the loop below on purpose. `it.each([])` registers zero
// cases and reports PASS, so an emptied or halved map would silence every case without
// failing anything. The action list here is written out rather than derived from the map
// it checks — derived, both sides would shrink together and the check could never fail.
const ACTIONS: FriendAction[] = ['send', 'cancel', 'accept', 'decline', 'remove'];

describe('FRIEND_FAILURE_TEXT', () => {
  it('carries a text for every action a surface can run', () => {
    expect(Object.keys(FRIEND_FAILURE_TEXT).sort()).toEqual([...ACTIONS].sort());
  });

  it.each(ACTIONS)('%s has a non-empty text', (action) => {
    expect(FRIEND_FAILURE_TEXT[action].trim().length).toBeGreaterThan(0);
  });

  // Distinctness is the ACTION half of the rule: different text per action. The other
  // half — same text regardless of cause — cannot be asserted here, because there is
  // only one text per action to compare; the call sites' tests drive that, by failing
  // the same action for two different reasons and reading the same string back.
  it('gives each action its own text, so a surface cannot blame the wrong one', () => {
    const texts = ACTIONS.map((a) => FRIEND_FAILURE_TEXT[a]);
    expect(new Set(texts).size).toBe(ACTIONS.length);
  });
});
