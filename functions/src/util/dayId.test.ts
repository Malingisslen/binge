import { describe, it, expect } from 'vitest';
import { stockholmDayId } from './dayId';

// BIN-350: the shared day-id is the single source of truth for product-facing
// daily/period buckets across scheduled functions. These cases pin the exact
// behavior the migration relies on: late-night UTC instants roll into the next
// Stockholm day, and the offset is DST-aware (CET +1 winter, CEST +2 summer).
describe('stockholmDayId — shared Stockholm-local day-id (BIN-350)', () => {
  it('rolls a late-evening winter (CET, +1) UTC instant into the next Stockholm day', () => {
    // 23:30Z in January is 00:30 the next day in Stockholm.
    expect(stockholmDayId(new Date('2026-01-15T23:30:00Z'))).toBe('2026-01-16');
  });

  it('rolls a late-evening summer (CEST, +2) UTC instant into the next Stockholm day', () => {
    // 22:30Z in July is 00:30 the next day in Stockholm.
    expect(stockholmDayId(new Date('2026-07-15T22:30:00Z'))).toBe('2026-07-16');
  });

  it('keeps a midday UTC instant on the same Stockholm day', () => {
    expect(stockholmDayId(new Date('2026-01-15T12:00:00Z'))).toBe('2026-01-15');
  });

  it('formats as YYYY-MM-DD (lexicographically chronological, matches doc-id shape)', () => {
    expect(stockholmDayId(new Date('2026-07-15T22:30:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('early-morning summer instant stays on its Stockholm day (just after local midnight)', () => {
    // 00:30Z in July is 02:30 Stockholm — same date, no rollback.
    expect(stockholmDayId(new Date('2026-07-16T00:30:00Z'))).toBe('2026-07-16');
  });
});
