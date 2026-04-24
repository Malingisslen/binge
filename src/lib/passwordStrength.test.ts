import { describe, it, expect } from 'vitest';
import { scorePassword } from './passwordStrength';

describe('scorePassword', () => {
  it('rejects empty passwords as unacceptable', () => {
    const r = scorePassword('');
    expect(r.score).toBe(0);
    expect(r.acceptable).toBe(false);
  });

  it('rejects anything shorter than 8 chars', () => {
    expect(scorePassword('abc').acceptable).toBe(false);
    expect(scorePassword('abc12').acceptable).toBe(false);
    expect(scorePassword('abcdefg').acceptable).toBe(false);
  });

  it('rejects common passwords even when long enough', () => {
    const r = scorePassword('password123');
    expect(r.score).toBe(0);
    expect(r.acceptable).toBe(false);
    expect(r.feedback).toContain('läckor');
  });

  it('rejects Swedish common passwords case-insensitively', () => {
    expect(scorePassword('Stockholm').acceptable).toBe(false);
    expect(scorePassword('STOCKHOLM').acceptable).toBe(false);
  });

  it('accepts mixed-class 8-char password at score 2+', () => {
    const r = scorePassword('Tjo12hej');
    expect(r.score).toBeGreaterThanOrEqual(2);
    expect(r.acceptable).toBe(true);
  });

  it('scores long multi-class as 4 (starkt)', () => {
    const r = scorePassword('MinLösenord1234!');
    expect(r.score).toBe(4);
    expect(r.label).toBe('Starkt');
  });

  it('scores single-class 10-char as 2 via length-tier', () => {
    // 10 chars, 1 class (bara lowercase) → score 2 via length-tier
    const r = scorePassword('abcdefghij');
    expect(r.score).toBe(2);
    expect(r.acceptable).toBe(true);
  });

  it('score 3 requires 12+ chars OR 2+ classes', () => {
    const r = scorePassword('abcdefghijkl12');
    expect(r.score).toBeGreaterThanOrEqual(3);
  });
});
