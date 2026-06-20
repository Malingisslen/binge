import { describe, it, expect } from 'vitest';
import { diffNewProviders, qualifyingProviders } from './logic';

describe('diffNewProviders (BIN-60)', () => {
  it('returns [] on first observation (last === null) — baseline, no first-run blast', () => {
    expect(diffNewProviders([8, 119], null)).toEqual([]);
  });

  it('returns only providers added since last observation', () => {
    expect(diffNewProviders([8, 119, 76], [8, 119])).toEqual([76]);
  });

  it('returns [] when nothing was added (even if some were removed)', () => {
    expect(diffNewProviders([8], [8, 119])).toEqual([]);
  });

  it('returns [] when current equals last (no change)', () => {
    expect(diffNewProviders([8, 119], [8, 119])).toEqual([]);
  });

  it('returns [] when the title left all providers (empty current)', () => {
    expect(diffNewProviders([], [8, 119])).toEqual([]);
  });
});

describe('qualifyingProviders (BIN-60)', () => {
  const on = { availableOnMyServices: true, pushEnabled: true };

  it('returns the new providers the user subscribes to', () => {
    expect(qualifyingProviders(on, [76, 8], [8])).toEqual([8]);
  });

  it('returns [] when none of the new providers are the user\'s', () => {
    expect(qualifyingProviders(on, [76], [8, 119])).toEqual([]);
  });

  it('returns [] when availableOnMyServices is off', () => {
    expect(qualifyingProviders({ availableOnMyServices: false, pushEnabled: true }, [8], [8])).toEqual([]);
  });

  it('returns [] when pushEnabled is off', () => {
    expect(qualifyingProviders({ availableOnMyServices: true, pushEnabled: false }, [8], [8])).toEqual([]);
  });

  it('returns [] when settings is null (user-doc missing)', () => {
    expect(qualifyingProviders(null, [8], [8])).toEqual([]);
  });
});
