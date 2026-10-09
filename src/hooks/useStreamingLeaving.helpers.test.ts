import { describe, it, expect } from 'vitest';
import { dropPassed } from './useStreamingLeaving.helpers';

describe('dropPassed', () => {
  const e = (leaving: string) => ({ tmdbId: 1, mediaType: 'movie' as const, leaving });

  it('drops titles whose leave date is before today, keeps today and later', () => {
    const out = dropPassed([e('2026-10-06'), e('2026-10-09'), e('2026-10-13')], '2026-10-09');
    expect(out.map(x => x.leaving)).toEqual(['2026-10-09', '2026-10-13']);
  });
});
