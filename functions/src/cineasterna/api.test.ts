import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const logger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock('firebase-functions/v2', () => ({ logger }));

import { fetchCatalog } from './api';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  logger.error.mockReset();
  logger.warn.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchCatalog', () => {
  it('opens the session the way the web app does and pages get_titles for one library', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { sessionid: 'sid-1', csrftoken: 'c', success: true }))
      .mockResolvedValueOnce(jsonResponse(200, { success: true, count: 2, titles: [{ name: 'A', imdb_id: 'tt0000001' }] }))
      .mockResolvedValueOnce(jsonResponse(200, { success: true, count: 2, titles: [{ name: 'B', imdb_id: 'tt0000002' }] }));

    const titles = await fetchCatalog();

    expect(titles.map((t) => t.imdbId)).toEqual(['tt0000001', 'tt0000002']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [sessionUrl, sessionInit] = fetchMock.mock.calls[0];
    expect(sessionUrl).toBe('https://backend.cineasterna.com/init_portal_session');
    expect(sessionInit.method).toBe('POST');
    expect(sessionInit.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(sessionInit.headers['X-App-Location']).toBe('https://www.cineasterna.com/sv/');
    const page2 = new URL(fetchMock.mock.calls[2][0]);
    expect(page2.pathname).toBe('/library/title/get_titles');
    expect(page2.searchParams.get('portal_sessionid')).toBe('sid-1');
    expect(page2.searchParams.get('library_id')).toBe('71');
    expect(page2.searchParams.get('page')).toBe('2');
    expect(fetchMock.mock.calls[2][1].headers['X-App-Location']).toBe('https://www.cineasterna.com/sv/');
  });

  it('logs a refused handshake and returns no titles without calling the catalogue', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { success: false }));

    expect(await fetchCatalog()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('init_portal_session -> 400'));
  });

  it('returns no titles and logs the page when one page is refused', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { sessionid: 'sid-1', success: true }))
      .mockResolvedValueOnce(jsonResponse(200, { success: true, count: 3, titles: [{ name: 'A', imdb_id: 'tt0000001' }] }))
      .mockResolvedValueOnce(jsonResponse(500, {}));

    expect(await fetchCatalog()).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('get_titles page 2 -> 500'));
  });
});
