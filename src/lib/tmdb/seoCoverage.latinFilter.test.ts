import { describe, it, expect } from 'vitest';
import { latinDisplayIds } from './seoCoverage';

describe('latinDisplayIds — SEO curation of non-Latin titles', () => {
  it('keeps a plain English movie title', () => {
    expect(latinDisplayIds([{ id: 1, title: 'Inception', original_title: 'Inception' }])).toEqual([1]);
  });

  it('keeps a foreign film that DISPLAYS a Latin title (display-based, not origin-based)', () => {
    // preferOriginalTitle renders "Parasite" (localized) since the original is non-Latin.
    expect(latinDisplayIds([{ id: 2, title: 'Parasite', original_title: '기생충' }])).toEqual([2]);
  });

  it('drops a title that actually renders in non-Latin script', () => {
    expect(latinDisplayIds([{ id: 3, title: '侠岚', original_title: '侠岚' }])).toEqual([]);
  });

  it('drops Japanese-kana and Cyrillic and Hangul displayed titles', () => {
    const items = [
      { id: 10, title: 'ドラえもん', original_title: 'ドラえもん' },
      { id: 11, title: 'Метро', original_title: 'Метро' },
      { id: 12, title: '오징어 게임', original_title: '오징어 게임' },
    ];
    expect(latinDisplayIds(items)).toEqual([]);
  });

  it('reads the TV name/original_name shape', () => {
    const items = [
      { id: 20, name: 'Breaking Bad', original_name: 'Breaking Bad' },
      { id: 21, name: '지금 우리 학교는', original_name: '지금 우리 학교는' },
    ];
    expect(latinDisplayIds(items)).toEqual([20]);
  });

  it('reads the person name-only shape', () => {
    const items = [
      { id: 30, name: 'Bong Joon-ho' },
      { id: 31, name: '봉준호' },
    ];
    expect(latinDisplayIds(items)).toEqual([30]);
  });

  it('skips items without an id and preserves order', () => {
    const items = [
      { title: 'No Id' },
      { id: 40, title: 'Alpha' },
      { id: 41, title: 'Beta' },
    ];
    expect(latinDisplayIds(items)).toEqual([40, 41]);
  });
});
