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
  it('opens the session the way the web app does and forwards it to get_new_titles', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { sessionid: 'sid-1', csrftoken: 'c', success: true }))
      .mockResolvedValueOnce(jsonResponse(200, {
        success: true,
        titles: [{ name: 'Pillion', imdb_id: 'tt32321317', is_rentable: false }],
      }));

    const titles = await fetchCatalog();

    expect(titles.map((t) => t.imdbId)).toEqual(['tt32321317']);
    const [sessionUrl, sessionInit] = fetchMock.mock.calls[0];
    expect(sessionUrl).toBe('https://backend.cineasterna.com/init_portal_session');
    expect(sessionInit.method).toBe('POST');
    expect(sessionInit.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(sessionInit.headers['X-App-Location']).toBe('https://www.cineasterna.com/sv/');
    const catalogUrl = new URL(fetchMock.mock.calls[1][0]);
    expect(catalogUrl.pathname).toBe('/library/title/get_new_titles');
    expect(catalogUrl.searchParams.get('portal_sessionid')).toBe('sid-1');
    expect(fetchMock.mock.calls[1][1].headers['X-App-Location']).toBe('https://www.cineasterna.com/sv/');
  });

  it('logs a refused handshake and returns no titles without calling the catalogue', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { success: false }));

    expect(await fetchCatalog()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('init_portal_session -> 400'));
  });

  it('warns when the answer hits the get_new_titles cap', async () => {
    const titles = Array.from({ length: 50 }, (_, i) => ({ name: `T${i}`, imdb_id: `tt${String(1000000 + i)}` }));
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { sessionid: 'sid-1', success: true }))
      .mockResolvedValueOnce(jsonResponse(200, { success: true, titles }));

    expect(await fetchCatalog()).toHaveLength(50);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('cap of 50'));
  });
});
