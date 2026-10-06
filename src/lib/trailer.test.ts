import { describe, it, expect } from 'vitest';
import { pickTrailer } from './trailer';
import type { TMDBVideo } from '@/types/tmdb';

const v = (key: string, type: string, lang?: string, site = 'YouTube'): TMDBVideo =>
  ({ id: key, key, name: key, site, type, official: true, iso_639_1: lang });

describe('pickTrailer', () => {
  it('väljer en trailer före en teaser oavsett språk', () => {
    expect(pickTrailer([v('teaser-sv', 'Teaser', 'sv'), v('trailer-en', 'Trailer', 'en')])?.key).toBe('trailer-en');
  });

  it('väljer ett svenskt klipp före ett engelskt, och ett engelskt före ett utan språk', () => {
    expect(pickTrailer([v('none', 'Trailer'), v('en', 'Trailer', 'en'), v('sv', 'Trailer', 'sv')])?.key).toBe('sv');
    expect(pickTrailer([v('none', 'Trailer'), v('en', 'Trailer', 'en')])?.key).toBe('en');
  });

  it('behåller TMDB:s ordning mellan likvärdiga klipp', () => {
    expect(pickTrailer([v('first', 'Trailer', 'en'), v('second', 'Trailer', 'en')])?.key).toBe('first');
  });

  it('hoppar över klipp som inte ligger på YouTube och andra sorter', () => {
    expect(pickTrailer([v('vimeo', 'Trailer', 'sv', 'Vimeo'), v('clip', 'Clip', 'sv')])).toBeUndefined();
    expect(pickTrailer(undefined)).toBeUndefined();
  });
});
