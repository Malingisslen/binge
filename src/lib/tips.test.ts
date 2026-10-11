import { describe, it, expect } from 'vitest';
import { buildTipFields, parseTip, tipDocId, titleHref, TIP_NOTE_MAX, TIP_TITLE_MAX } from './tips';

describe('tipDocId', () => {
  it('joins the sender uid and the canonical title id, so a re-tip lands on the same doc', () => {
    expect(tipDocId('abc', 'movie', 603)).toBe('abc_movie_603');
    expect(tipDocId('abc', 'tv', 1399)).toBe('abc_tv_1399');
  });
});

describe('buildTipFields', () => {
  const base = { fromUid: 'abc', mediaType: 'movie' as const, tmdbId: 603, title: 'The Matrix', note: '' };

  it('writes exactly the keys firestore.rules whitelists, minus the server timestamp', () => {
    expect(Object.keys(buildTipFields({ ...base, note: 'Se den' })).sort())
      .toEqual(['fromUid', 'mediaType', 'note', 'title', 'tmdbId']);
  });

  it('leaves an empty or whitespace note out instead of storing it', () => {
    expect(buildTipFields(base)).not.toHaveProperty('note');
    expect(buildTipFields({ ...base, note: '   ' })).not.toHaveProperty('note');
  });

  it('trims and caps the note and the title at the rule limits', () => {
    const f = buildTipFields({ ...base, title: ` ${'t'.repeat(300)} `, note: ` ${'n'.repeat(300)} ` });
    expect(f.title).toBe('t'.repeat(TIP_TITLE_MAX));
    expect(f.note).toBe('n'.repeat(TIP_NOTE_MAX));
  });
});

describe('parseTip', () => {
  const createdAt = { toDate: () => new Date(Date.UTC(2026, 9, 11)) };
  const good = { fromUid: 'abc', mediaType: 'tv', tmdbId: 1399, title: 'Game of Thrones', note: 'Kolla', createdAt };

  it('reads a stored tip', () => {
    expect(parseTip('abc_tv_1399', good)).toEqual({
      id: 'abc_tv_1399', fromUid: 'abc', mediaType: 'tv', tmdbId: 1399,
      title: 'Game of Thrones', note: 'Kolla', createdAt: new Date(Date.UTC(2026, 9, 11)),
    });
  });

  it('gives a missing note as null', () => {
    const rest: Record<string, unknown> = { ...good };
    delete rest.note;
    expect(parseTip('x', rest)?.note).toBeNull();
  });

  it('skips a doc without the shape the rules write', () => {
    expect(parseTip('x', { ...good, fromUid: '' })).toBeNull();
    expect(parseTip('x', { ...good, mediaType: 'person' })).toBeNull();
    expect(parseTip('x', { ...good, tmdbId: '1399' })).toBeNull();
    expect(parseTip('x', { ...good, tmdbId: 0 })).toBeNull();
    expect(parseTip('x', { ...good, title: '' })).toBeNull();
  });
});

describe('titleHref', () => {
  it('points at the title page for each media type', () => {
    expect(titleHref('movie', 603)).toBe('/movie/603/');
    expect(titleHref('tv', 1399)).toBe('/tv/1399/');
  });
});
