import { describe, it, expect } from 'vitest';
import { buildRestoreWrites, type RemovedTitle } from './restoreRemoved';

function removed(over: Partial<RemovedTitle> = {}): RemovedTitle {
  return {
    mediaType: 'tv', tmdbId: 1396, docId: 'tv_1396', removalGen: 1,
    item: { tmdbId: 1396, mediaType: 'tv', status: 'mina', rating: 4.5, title: 'Breaking Bad' },
    tags: { tags: ['favorit'], mediaType: 'tv' },
    notes: { note: 'Se om säsong 5', mediaType: 'tv' },
    ...over,
  };
}

describe('buildRestoreWrites (BIN-1430)', () => {
  it('writes all three documents back exactly as they were read', () => {
    const r = removed();
    expect(buildRestoreWrites(r)).toEqual({ item: r.item, tags: r.tags, notes: r.notes });
  });

  it('keeps a null inline notes key, which the rules accept', () => {
    const r = removed({ item: { tmdbId: 1, mediaType: 'movie', notes: null } });
    expect(buildRestoreWrites(r).item).toEqual({ tmdbId: 1, mediaType: 'movie', notes: null });
  });

  it('moves a legacy inline note into the notes document instead of dropping it', () => {
    const r = removed({ item: { tmdbId: 1396, mediaType: 'tv', notes: 'gammal anteckning' }, notes: null });
    const w = buildRestoreWrites(r);
    expect(w.item).not.toHaveProperty('notes');
    expect(w.notes).toEqual({ note: 'gammal anteckning', mediaType: 'tv' });
  });

  it('lets an existing notes document win over a legacy inline note', () => {
    const r = removed({ item: { tmdbId: 1396, mediaType: 'tv', notes: 'gammal' } });
    const w = buildRestoreWrites(r);
    expect(w.item).not.toHaveProperty('notes');
    expect(w.notes).toEqual({ note: 'Se om säsong 5', mediaType: 'tv' });
  });

  it('writes no sibling documents that did not exist', () => {
    const w = buildRestoreWrites(removed({ tags: null, notes: null }));
    expect(w.tags).toBeNull();
    expect(w.notes).toBeNull();
  });
});
