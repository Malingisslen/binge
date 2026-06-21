import { describe, it, expect } from 'vitest';
import { svwikiTitleFromEntities, cleanWikiExtract } from './bio';

describe('svwikiTitleFromEntities', () => {
  it('extracts the svwiki sitelink title', () => {
    const json = { entities: { Q42: { sitelinks: { svwiki: { title: 'Greta Garbo' }, enwiki: { title: 'Greta Garbo (en)' } } } } };
    expect(svwikiTitleFromEntities(json, 'Q42')).toBe('Greta Garbo');
  });
  it('returns null when there is no svwiki sitelink', () => {
    const json = { entities: { Q42: { sitelinks: { enwiki: { title: 'X' } } } } };
    expect(svwikiTitleFromEntities(json, 'Q42')).toBeNull();
  });
  it('returns null for malformed input', () => {
    expect(svwikiTitleFromEntities(null, 'Q42')).toBeNull();
    expect(svwikiTitleFromEntities({ entities: {} }, 'Q42')).toBeNull();
  });
});

describe('cleanWikiExtract', () => {
  it('returns text + page url for a standard summary', () => {
    const summary = { type: 'standard', extract: 'Greta Garbo var en svensk skådespelare.', content_urls: { desktop: { page: 'https://sv.wikipedia.org/wiki/Greta_Garbo' } } };
    expect(cleanWikiExtract(summary)).toEqual({ text: 'Greta Garbo var en svensk skådespelare.', pageUrl: 'https://sv.wikipedia.org/wiki/Greta_Garbo' });
  });
  it('rejects disambiguation pages', () => {
    expect(cleanWikiExtract({ type: 'disambiguation', extract: 'kan syfta på...' })).toBeNull();
  });
  it('rejects empty/too-short extracts', () => {
    expect(cleanWikiExtract({ type: 'standard', extract: '   ', content_urls: { desktop: { page: 'x' } } })).toBeNull();
  });
  it('returns null for malformed input', () => {
    expect(cleanWikiExtract(undefined)).toBeNull();
  });
  it('rejects non-https page URLs (javascript: scheme)', () => {
    const summary = { type: 'standard', extract: 'Greta Garbo var en svensk skådespelare.', content_urls: { desktop: { page: 'javascript:alert(1)' } } };
    expect(cleanWikiExtract(summary)).toBeNull();
  });
  it('rejects non-https page URLs (http: scheme)', () => {
    const summary = { type: 'standard', extract: 'Greta Garbo var en svensk skådespelare.', content_urls: { desktop: { page: 'http://x' } } };
    expect(cleanWikiExtract(summary)).toBeNull();
  });
  it('accepts a valid https page URL', () => {
    const summary = { type: 'standard', extract: 'Greta Garbo var en svensk skådespelare.', content_urls: { desktop: { page: 'https://sv.wikipedia.org/wiki/Greta_Garbo' } } };
    expect(cleanWikiExtract(summary)).toEqual({ text: 'Greta Garbo var en svensk skådespelare.', pageUrl: 'https://sv.wikipedia.org/wiki/Greta_Garbo' });
  });
});
