import { describe, it, expect } from 'vitest';
import { reviewSchema, movieSchema, tvSchema, personSchema, type ReviewSchemaInput } from './JsonLd';

const base: ReviewSchemaInput = {
  id: 'r1', authorName: 'Anna', reviewBody: 'Riktigt bra.', rating: 8,
  itemName: 'Dune', itemType: 'Movie', itemUrl: 'https://binge.nu/movie/438631/',
};

describe('reviewSchema', () => {
  it('builds a Review embedded in itemReviewed', () => {
    const s = reviewSchema(base);
    expect(s['@type']).toBe('Review');
    expect(s.reviewBody).toBe('Riktigt bra.');
    expect(s.author).toEqual({ '@type': 'Person', name: 'Anna' });
    expect(s.itemReviewed).toEqual({ '@type': 'Movie', name: 'Dune', url: 'https://binge.nu/movie/438631/' });
  });
  it('maps a 0–10 rating to reviewRating with bestRating 10', () => {
    expect(reviewSchema(base).reviewRating).toEqual({ '@type': 'Rating', ratingValue: 8, bestRating: 10, worstRating: 1 });
  });
  it('omits reviewRating when rating is null', () => {
    expect(reviewSchema({ ...base, rating: null }).reviewRating).toBeUndefined();
  });
  it('supports TVSeries itemType', () => {
    const s = reviewSchema({ ...base, itemType: 'TVSeries', itemName: 'Severance' });
    expect((s.itemReviewed as Record<string, unknown>)['@type']).toBe('TVSeries');
  });
  it('falls back to "Anonym" when authorName is empty', () => {
    expect(reviewSchema({ ...base, authorName: '' }).author).toEqual({ '@type': 'Person', name: 'Anonym' });
  });
});

// SEO-9 — the schema says what the visible page says, not TMDB's raw fields.
const movie = {
  id: 1, title: 'Amélie från Montmartre', original_title: 'Le Fabuleux Destin d\'Amélie Poulain',
  overview: '', poster_path: null,
};
const show = { id: 2, name: 'Pengarna', original_name: 'La casa de papel', overview: '', poster_path: null };

describe('movieSchema / tvSchema (SEO-9)', () => {
  it('names the title as the H1 does, with the other title as alternateName', () => {
    const m = movieSchema(movie, { name: movie.original_title, description: 'x' });
    expect(m.name).toBe(movie.original_title);
    expect(m.alternateName).toBe(movie.title);
    const t = tvSchema(show, { name: show.original_name, description: 'x' });
    expect(t.name).toBe(show.original_name);
    expect(t.alternateName).toBe(show.name);
  });

  it('carries no alternateName when both titles are the page name', () => {
    const m = movieSchema({ ...movie, title: 'Dune', original_title: 'Dune' }, { name: 'Dune', description: 'x' });
    expect(m).not.toHaveProperty('alternateName');
  });

  it('uses the content-floor description even when TMDB overview is empty', () => {
    expect(movieSchema(movie, { name: movie.title, description: 'Floor.' }).description).toBe('Floor.');
    expect(tvSchema(show, { name: show.name, description: 'Floor.' }).description).toBe('Floor.');
  });

  it('omits description rather than shipping an empty one', () => {
    expect(movieSchema(movie, { name: movie.title, description: undefined })).not.toHaveProperty('description');
    expect(tvSchema(show, { name: show.name, description: '' })).not.toHaveProperty('description');
  });
});

describe('personSchema (SEO-9)', () => {
  const person = {
    id: 3, name: 'Greta Garbo', profile_path: '/g.jpg', birthday: '1905-09-18', deathday: '1990-04-15',
    place_of_birth: 'Stockholm, Sverige',
  };

  it('carries the facts it is given', () => {
    const p = personSchema(person, { description: 'Bio.', jobTitle: 'Skådespelare' });
    expect(p).toMatchObject({
      '@type': 'Person', name: 'Greta Garbo', url: 'https://binge.nu/person/3/',
      image: 'https://image.tmdb.org/t/p/w500/g.jpg', birthDate: '1905-09-18', deathDate: '1990-04-15',
      birthPlace: 'Stockholm, Sverige', jobTitle: 'Skådespelare', description: 'Bio.',
    });
  });

  it('omits every fact it is not given', () => {
    const p = personSchema(
      { id: 3, name: 'X', profile_path: null, birthday: null, deathday: null, place_of_birth: null },
      { description: undefined, jobTitle: null },
    );
    for (const k of ['image', 'birthDate', 'deathDate', 'birthPlace', 'jobTitle', 'description']) {
      expect(p).not.toHaveProperty(k);
    }
  });
});
