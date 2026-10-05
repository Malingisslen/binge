import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { createTitlePrefetcher } from './hoverPrefetch';

// A TMDB fetch that stays in flight until aborted, and records its abort.
const aborted: string[] = [];
function pending(label: string, signal?: AbortSignal) {
  return new Promise<never>((_, reject) => {
    signal?.addEventListener('abort', () => { aborted.push(label); reject(new DOMException('aborted', 'AbortError')); });
  });
}
vi.mock('./client', () => ({
  getMovie: (id: number, opts?: { signal?: AbortSignal }) => pending(`movie-${id}`, opts?.signal),
  getTVShow: (id: number, opts?: { signal?: AbortSignal }) => pending(`tv-${id}`, opts?.signal),
  getTVSeason: vi.fn(),
}));

const fetching = (qc: QueryClient) =>
  qc.getQueryCache().findAll({ fetchStatus: 'fetching' }).map(q => q.queryKey.join('-'));

describe('createTitlePrefetcher (PERF-7)', () => {
  let qc: QueryClient;
  beforeEach(() => {
    aborted.length = 0;
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it('keeps at most one hover prefetch in flight — a newer hover aborts the older one', async () => {
    const p = createTitlePrefetcher(qc);
    p.hover('/movie/1/');
    p.hover('/tv/2/');
    p.hover('/movie/3/');
    await Promise.resolve();
    expect(aborted).toEqual(['movie-1', 'tv-2']);
    expect(fetching(qc)).toEqual(['movie-3']);
  });

  it('never aborts a click or focus prefetch', async () => {
    const p = createTitlePrefetcher(qc);
    p.now('/movie/1/');
    p.hover('/movie/2/');
    p.hover('/movie/3/');
    await Promise.resolve();
    expect(aborted).toEqual(['movie-2']);
    expect(fetching(qc).sort()).toEqual(['movie-1', 'movie-3']);
  });

  it('a hover followed by a click on the same link is promoted and survives the next hover', async () => {
    const p = createTitlePrefetcher(qc);
    p.hover('/movie/1/');
    p.now('/movie/1/');
    p.hover('/movie/2/');
    await Promise.resolve();
    expect(aborted).toEqual([]);
  });

  it('does not abort a hover prefetch a page is already reading', async () => {
    const p = createTitlePrefetcher(qc);
    p.hover('/movie/1/');
    const unsubscribe = new QueryObserver(qc, { queryKey: ['movie', 1], enabled: false }).subscribe(() => {});
    p.hover('/movie/2/');
    await Promise.resolve();
    expect(aborted).toEqual([]);
    unsubscribe();
  });
});
