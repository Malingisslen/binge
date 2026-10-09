import { describe, it, expect } from 'vitest';
import { resolveDisplayName, firstLatinAlias, personName } from './displayName';

describe('resolveDisplayName', () => {
  it('keeps a Swedish name and shows the non-Latin original underneath', () => {
    expect(resolveDisplayName({ localized: 'Svensk titel', original: '원제' })).toEqual({
      primary: 'Svensk titel',
      secondary: '원제',
    });
  });

  it('falls back to the English name when Swedish and original are both non-Latin', () => {
    expect(
      resolveDisplayName({ localized: '닥터X', original: '닥터X', english: 'Doctor X' }),
    ).toEqual({ primary: 'Doctor X', secondary: '닥터X' });
  });

  it('keeps the non-Latin name when there is no Latin source at all', () => {
    expect(resolveDisplayName({ localized: '닥터X', original: '닥터X' })).toEqual({
      primary: '닥터X',
      secondary: null,
    });
  });

  it('ignores a non-Latin english value', () => {
    expect(
      resolveDisplayName({ localized: '닥터X', original: '닥터X', english: '닥터엑스' }),
    ).toEqual({ primary: '닥터X', secondary: null });
  });

  it('shows no secondary line when the names are all Latin', () => {
    expect(resolveDisplayName({ localized: 'Inception', original: 'Inception' })).toEqual({
      primary: 'Inception',
      secondary: null,
    });
  });

  it('uses a Latin original over a non-Latin localized name (person credits)', () => {
    expect(resolveDisplayName({ localized: '渡辺謙', original: 'Ken Watanabe' })).toEqual({
      primary: 'Ken Watanabe',
      secondary: '渡辺謙',
    });
  });

  it('uses a Latin alias for a person whose only names are non-Latin', () => {
    expect(
      resolveDisplayName({ localized: '渡辺謙', english: firstLatinAlias(['渡辺 謙', 'Ken Watanabe']) }),
    ).toEqual({ primary: 'Ken Watanabe', secondary: '渡辺謙' });
  });

  it('falls back to a placeholder when nothing is given', () => {
    expect(resolveDisplayName({}).primary).toBe('Okänd titel');
  });
});

describe('firstLatinAlias', () => {
  it('skips non-Latin entries', () => {
    expect(firstLatinAlias(['渡辺謙', 'Ken Watanabe'])).toBe('Ken Watanabe');
  });
  it('returns null without a Latin alias', () => {
    expect(firstLatinAlias(['渡辺謙'])).toBeNull();
    expect(firstLatinAlias(undefined)).toBeNull();
  });
});

describe('personName', () => {
  // TMDB's sv-SE credits give both fields in kanji for Ken Watanabe; en-US has the Latin name.
  const watanabe = { id: 3899, name: '渡辺謙', original_name: '渡辺謙' };

  it('uses the en-US name for a person whose sv-SE names are both non-Latin', () => {
    expect(personName(watanabe, new Map([[3899, 'Ken Watanabe']]))).toEqual({
      primary: 'Ken Watanabe',
      secondary: '渡辺謙',
    });
  });

  it('keeps the original script when no Latin name is known yet', () => {
    expect(personName(watanabe).primary).toBe('渡辺謙');
  });

  it('leaves a Latin name alone even when the map has another spelling', () => {
    expect(personName({ id: 500, name: 'Tom Cruise' }, new Map([[500, 'Thomas Cruise']])).primary).toBe('Tom Cruise');
  });
});
