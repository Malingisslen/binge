import { describe, it, expect } from 'vitest';
import { isSeasonRecapLoading } from './useRecap.helpers';

describe('isSeasonRecapLoading — loading/error vs. genuinely-empty', () => {
  it('is true for isSuccess:false — covers BOTH pending and errored, indistinguishably: ' +
     'this is the bug that shipped once already (an earlier "isPending" check alone reported ' +
     'a timed-out/errored read as settled, since React Query sets isPending to false on ' +
     'error too, identical to success — isSuccess:false is the only shape that catches both)', () => {
    expect(isSeasonRecapLoading(true, { isSuccess: false })).toBe(true);
  });

  it('is false once the query has genuinely succeeded', () => {
    expect(isSeasonRecapLoading(true, { isSuccess: true })).toBe(false);
  });

  it('is false when not enabled, regardless of query state (pre-expand)', () => {
    expect(isSeasonRecapLoading(false, { isSuccess: false })).toBe(false);
    expect(isSeasonRecapLoading(false, { isSuccess: true })).toBe(false);
  });

  it('treats an undefined result (query not yet in the results array) as not-yet-resolved', () => {
    expect(isSeasonRecapLoading(true, undefined)).toBe(true);
  });
});
