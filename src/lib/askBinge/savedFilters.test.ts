import { describe, it, expect } from 'vitest';
import { applySavedFilters } from './savedFilters';
import type { RowTitle } from '@/types';

const t = (over: Partial<RowTitle> & { name?: string }): RowTitle =>
  ({ id: 1, media_type: 'tv', ...over }) as RowTitle;

const korean = t({ id: 1, name: '순정에 반하다', original_name: '순정에 반하다', origin_country: ['KR'] });
const koreanLatin = t({ id: 2, name: 'Crash Landing on You', original_name: '사랑의 불시착', origin_country: ['KR'] });
const swedish = t({ id: 3, name: 'Bonusfamiljen', original_name: 'Bonusfamiljen', origin_country: ['SE'] });
const all = [korean, koreanLatin, swedish];

describe('applySavedFilters', () => {
  it('drops non-Latin titles, including a Latin display name over a non-Latin original', () => {
    const out = applySavedFilters(all, {}, { hideNonLatinTitles: true, hiddenCountries: [] });
    expect(out.map((x) => x.id)).toEqual([3]);
  });

  it('drops titles from hidden countries even with Latin titles', () => {
    const out = applySavedFilters(all, {}, { hideNonLatinTitles: false, hiddenCountries: ['KR'] });
    expect(out.map((x) => x.id)).toEqual([3]);
  });

  it('keeps everything when no filter is saved', () => {
    expect(applySavedFilters(all, {}, { hideNonLatinTitles: false, hiddenCountries: [] })).toHaveLength(3);
  });

  it('lets an explicit language in the question override the saved filters', () => {
    const out = applySavedFilters(all, { originalLanguage: 'ko' }, { hideNonLatinTitles: true, hiddenCountries: ['KR'] });
    expect(out).toHaveLength(3);
  });
});
