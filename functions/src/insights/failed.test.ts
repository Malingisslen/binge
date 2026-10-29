import { describe, it, expect } from 'vitest';
import { failedSources } from './failed';

const ok = { rollup: { partial: false }, eventsFailed: false, history: [], traffic: {} };

describe('failedSources', () => {
  it('is empty when every source was read', () => {
    expect(failedSources(ok)).toEqual([]);
  });

  it('names exactly the source that failed, one at a time', () => {
    expect(failedSources({ ...ok, rollup: null })).toEqual(['rollup']);
    expect(failedSources({ ...ok, rollup: { partial: true } })).toEqual(['rollup']);
    expect(failedSources({ ...ok, eventsFailed: true })).toEqual(['events']);
    expect(failedSources({ ...ok, history: null })).toEqual(['history']);
    expect(failedSources({ ...ok, traffic: null })).toEqual(['traffic']);
  });

  it('lists every failed source when several fail', () => {
    expect(failedSources({ rollup: null, eventsFailed: true, history: null, traffic: null }))
      .toEqual(['rollup', 'events', 'history', 'traffic']);
  });

  it('an empty history or an empty traffic block is a measured result, not a failure', () => {
    expect(failedSources({ ...ok, history: [], traffic: { visits: 0 } })).toEqual([]);
  });
});
