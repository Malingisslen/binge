// BIN-1233. Profilsidan slår upp användare på användarnamn, så admin-vyns länk till en
// anmäld användare måste bära användarnamnet — en uid-länk öppnar "Användaren hittades
// inte" för ett konto som finns.
import { describe, it, expect } from 'vitest';
import { buildTargetLink } from './reportTargetLink';

describe('buildTargetLink (BIN-1233)', () => {
  it('en användaranmälan leder till profilen på användarnamnet, aldrig på uid:t', () => {
    expect(buildTargetLink({ targetType: 'user', targetId: 'uid-123' }, 'kalle')).toBe('/user/kalle');
  });

  it('en användaranmälan utan läsbart användarnamn får ingen länk alls', () => {
    expect(buildTargetLink({ targetType: 'user', targetId: 'uid-123' }, null)).toBeNull();
  });

  it('en listanmälan leder till listan på sitt id, oberoende av användarnamn', () => {
    expect(buildTargetLink({ targetType: 'list', targetId: 'l1' }, null)).toBe('/list/l1');
  });

  it('recensioner och kommentarer har ingen direktlänk', () => {
    expect(buildTargetLink({ targetType: 'review', targetId: 'r1' }, 'kalle')).toBeNull();
    expect(buildTargetLink({ targetType: 'comment', targetId: 'reviews/r1/comments/c1' }, 'kalle')).toBeNull();
  });
});
