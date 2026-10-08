import { describe, it, expect, vi } from 'vitest';
import { collectAllPages, parseTitlesPage } from './paging';

function page(count: number, ids: string[]) {
  return { success: true, count, titles: ids.map((imdb_id) => ({ name: imdb_id, imdb_id })) };
}

describe('collectAllPages', () => {
  it('pages until the raw titles reach count, and keeps only titles with an imdb id', async () => {
    const pages: Record<number, unknown> = {
      1: page(5, ['tt0000001', 'tt0000002']),
      2: page(5, ['tt0000003', '']),
      3: page(5, ['tt0000005']),
    };
    const fetchPage = vi.fn(async (n: number) => pages[n]);

    const titles = await collectAllPages(fetchPage);

    expect(titles?.map((t) => t.imdbId)).toEqual(['tt0000001', 'tt0000002', 'tt0000003', 'tt0000005']);
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual([1, 2, 3]);
  });

  it('gives up on the whole catalogue when one page fails', async () => {
    const fetchPage = vi.fn(async (n: number) => (n === 2 ? null : page(6, ['tt0000001', 'tt0000002', 'tt0000003'])));
    expect(await collectAllPages(fetchPage)).toBeNull();
  });

  it('gives up when a page comes back empty before count is reached', async () => {
    const fetchPage = vi.fn(async (n: number) => (n === 1 ? page(10, ['tt0000001']) : page(10, [])));
    expect(await collectAllPages(fetchPage)).toBeNull();
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('stops at the page ceiling instead of paging forever', async () => {
    const fetchPage = vi.fn(async () => page(1_000_000, ['tt0000001']));
    expect(await collectAllPages(fetchPage, { maxPages: 3 })).toBeNull();
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });
});

describe('collectAllPages deadline', () => {
  it('requests no page after the deadline has passed', async () => {
    let clock = 0;
    const fetchPage = vi.fn(async () => {
      clock += 100;
      return page(10, ['tt0000001']);
    });
    expect(await collectAllPages(fetchPage, { deadlineMs: 250, now: () => clock })).toBeNull();
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });
});

describe('parseTitlesPage', () => {
  it('rejects an answer without success, count or titles', () => {
    expect(parseTitlesPage({ success: false, error_code: 'INVALID_PARAMS' })).toBeNull();
    expect(parseTitlesPage({ success: true, titles: [] })).toBeNull();
    expect(parseTitlesPage(null)).toBeNull();
  });
});
