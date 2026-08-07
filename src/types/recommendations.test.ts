import { describe, it, expect } from 'vitest';
import { rowKey, parseRowKey, type RowId } from './recommendations';

const VALID_IDS: RowId[] = [
  { kind: 'similar', mediaType: 'movie', tmdbId: 603 },
  { kind: 'similar', mediaType: 'tv', tmdbId: 1399 },
  { kind: 'person', personId: 140607 },
  { kind: 'genre-canon', genreId: 18 },
  { kind: 'thematic', keywordId: 9663 },
  { kind: 'trending' },
  { kind: 'latest-fav' },
  { kind: 'upcoming' },
  { kind: 'free-public' },
  { kind: 'companion' },
];

describe('rowKey + parseRowKey', () => {
  it.each(VALID_IDS)('round-trips %s', (id) => {
    const key = rowKey(id);
    const parsed = parseRowKey(key);
    expect(parsed).toEqual(id);
  });

  it.each([
    ['', 'empty'],
    ['random', 'unknown prefix'],
    ['person:', 'empty id'],
    ['person:abc', 'non-numeric id'],
    ['person:0', 'zero id'],
    ['person:-5', 'negative id'],
    ['person:1.5', 'non-integer id'],
    ['similar:movie:', 'missing id'],
    ['similar:tv:abc', 'non-numeric id'],
    ['similar:invalid:42', 'invalid mediaType'],
    ['similar:movie:42:extra', 'too many parts'],
    ['genre:', 'empty genre id'],
    ['keyword:foo', 'non-numeric keyword'],
  ])('rejects "%s" (%s)', (key) => {
    expect(parseRowKey(key)).toBeNull();
  });
});
