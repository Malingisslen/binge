import { describe, it, expect } from 'vitest';
import { rankSearchResults } from './searchRanking';

describe('rankSearchResults', () => {
  it('lifts a title that starts with the typed text above earlier, merely matching hits', () => {
    const items = [
      { name: 'The Dun Cow', poster_path: null },
      { title: 'Abandun', poster_path: '/a.jpg' },
      { title: 'Dune', poster_path: '/d.jpg' },
    ];
    expect(rankSearchResults(items, 'dun').map(i => i.title ?? i.name)).toEqual(['Dune', 'Abandun', 'The Dun Cow']);
  });

  it('puts titles without a poster after those with one, keeping TMDB order otherwise', () => {
    const items = [
      { title: 'A', poster_path: null },
      { title: 'B', poster_path: '/b.jpg' },
      { title: 'C', poster_path: '/c.jpg' },
    ];
    expect(rankSearchResults(items, 'x').map(i => i.title)).toEqual(['B', 'C', 'A']);
  });

  it('matches the original title too', () => {
    const items = [
      { title: 'Something', poster_path: '/s.jpg' },
      { title: 'Snöstorm', original_title: 'Dune Storm', poster_path: '/x.jpg' },
    ];
    expect(rankSearchResults(items, 'Dune')[0].title).toBe('Snöstorm');
  });

  it('puts the better-known of two equally good matches first', () => {
    const items = [
      { title: 'Parasite', poster_path: '/a.jpg', popularity: 3 },
      { title: 'Parasite', poster_path: '/b.jpg', popularity: 90 },
    ];
    expect(rankSearchResults(items, 'Parasite').map(i => i.popularity)).toEqual([90, 3]);
  });

  it('does not let popularity beat a title that starts with the query', () => {
    const items = [
      { title: 'Big Hit', poster_path: '/a.jpg', popularity: 500 },
      { title: 'Parasite', poster_path: '/b.jpg', popularity: 1 },
    ];
    expect(rankSearchResults(items, 'Parasite')[0].title).toBe('Parasite');
  });
});
