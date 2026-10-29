import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const logger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock('firebase-functions/v2', () => ({ logger }));
import { buildTrafficQuery, readTraffic, summarizeTraffic, trafficWindow, EMPTY_TRAFFIC, TRAFFIC_SINCE, TRAFFIC_TOP_N, type RumRow } from './traffic';

const row = (dims: RumRow['dimensions'], count: number, visits: number): RumRow => ({
  count, sum: { visits }, dimensions: dims,
});

describe('trafficWindow', () => {
  it('starts at midnight of the first day and ends before midnight after the last day', () => {
    expect(trafficWindow({ preset: '7d', from: '2026-11-02', to: '2026-11-08' })).toEqual({
      geq: '2026-11-02T00:00:00Z', lt: '2026-11-09T00:00:00Z',
    });
  });

  it('crosses a month end', () => {
    expect(trafficWindow({ preset: 'custom', from: '2026-10-30', to: '2026-10-31' }).lt).toBe('2026-11-01T00:00:00Z');
  });

  it('never starts before the beacon went live: a straddling range is clipped, a later one untouched', () => {
    expect(trafficWindow({ preset: 'custom', from: '2026-10-01', to: '2026-11-05' }).geq).toBe(`${TRAFFIC_SINCE}T00:00:00Z`);
    expect(trafficWindow({ preset: 'custom', from: TRAFFIC_SINCE, to: '2026-11-05' }).geq).toBe(`${TRAFFIC_SINCE}T00:00:00Z`);
    expect(trafficWindow({ preset: 'custom', from: '2026-11-02', to: '2026-11-05' }).geq).toBe('2026-11-02T00:00:00Z');
  });
});

describe('buildTrafficQuery', () => {
  it('passes the tags and the window as variables, never inlined in the query text', () => {
    const q = buildTrafficQuery('acct', 'site', { preset: '7d', from: '2026-11-02', to: '2026-11-08' });
    expect(q.variables).toEqual({ accountTag: 'acct', siteTag: 'site', geq: '2026-11-02T00:00:00Z', lt: '2026-11-09T00:00:00Z', top: TRAFFIC_TOP_N });
    expect(q.query).toContain('$siteTag');
    expect(q.query).toContain('$accountTag');
    // No literal value in the query text: every value travels as a variable.
    expect(q.query).not.toMatch(/"[^"]*"/);
    expect(q.query).toContain('rumPageloadEventsAdaptiveGroups');
  });
});

describe('summarizeTraffic', () => {
  it('sums visits and page views from the daily rows, oldest day first', () => {
    const t = summarizeTraffic({
      daily: [row({ date: '2026-10-24' }, 5, 2), row({ date: '2026-10-23' }, 3, 1)],
      pages: [], referrers: [],
    });
    expect(t.visits).toBe(3);
    expect(t.pageViews).toBe(8);
    expect(t.daily.map((d) => d.date)).toEqual(['2026-10-23', '2026-10-24']);
  });

  it('keeps empty referrer hosts (direct visits) and drops rows with no count', () => {
    const t = summarizeTraffic({
      daily: [],
      pages: [row({ requestPath: '/' }, 4, 1), row({ requestPath: '/zero' }, 0, 0)],
      referrers: [row({ refererHost: '' }, 4, 3), row({ refererHost: 'none.example' }, 1, 0)],
    });
    expect(t.topPages).toEqual([{ path: '/', pageViews: 4 }]);
    expect(t.topReferrers).toEqual([{ host: '', visits: 3 }]);
  });

  it('a successful read with no rows is a measured zero: totals 0, empty curve and lists, never null', () => {
    const t = summarizeTraffic({ daily: [], pages: [], referrers: [] });
    expect(t).toEqual({ visits: 0, pageViews: 0, daily: [], topPages: [], topReferrers: [] });
  });

  it('caps the lists at TRAFFIC_TOP_N', () => {
    const many = Array.from({ length: TRAFFIC_TOP_N + 3 }, (_, i) => row({ requestPath: `/p${i}` }, 10 - (i % 10) + 1, 1));
    expect(summarizeTraffic({ daily: [], pages: many, referrers: [] }).topPages).toHaveLength(TRAFFIC_TOP_N);
  });

  it('treats a missing number as zero instead of NaN, on either side', () => {
    const t = summarizeTraffic({
      daily: [
        { count: 2, sum: {} as { visits: number }, dimensions: { date: '2026-10-23' } },
        { count: undefined as unknown as number, sum: { visits: 4 }, dimensions: { date: '2026-10-24' } },
      ],
      pages: [], referrers: [],
    });
    expect(t.visits).toBe(4);
    expect(t.pageViews).toBe(2);
    expect(t.daily).toEqual([{ date: '2026-10-23', visits: 0, pageViews: 2 }, { date: '2026-10-24', visits: 4, pageViews: 0 }]);
  });

  it('drops a daily row without a date and labels a referrer row without a host as the empty host', () => {
    const t = summarizeTraffic({
      daily: [row({ date: '2026-10-23' }, 1, 1), { count: 5, sum: { visits: 5 }, dimensions: {} }],
      pages: [],
      referrers: [{ count: 2, sum: { visits: 2 }, dimensions: {} }],
    });
    expect(t.daily).toEqual([{ date: '2026-10-23', visits: 1, pageViews: 1 }]);
    expect(t.visits).toBe(1);
    expect(t.topReferrers).toEqual([{ host: '', visits: 2 }]);
  });
});

describe('readTraffic', () => {
  const range = { preset: '7d' as const, from: '2026-11-02', to: '2026-11-08' };
  const fetchMock = vi.fn();
  const env = { CF_ANALYTICS_TOKEN: 'secret-token-value', CF_ACCOUNT_ID: 'acct', CF_SITE_TAG: 'site' };
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    logger.error.mockReset();
    Object.assign(process.env, env);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of Object.keys(env)) delete process.env[k];
  });
  const loggedText = () => JSON.stringify(logger.error.mock.calls);

  it('is null when any one of the three secrets is missing, without calling Cloudflare, and says so in the log', async () => {
    for (const k of Object.keys(env)) {
      Object.assign(process.env, env);
      delete process.env[k];
      logger.error.mockReset();
      expect(await readTraffic(range), k).toBeNull();
      expect(fetchMock, k).not.toHaveBeenCalled();
      expect(loggedText(), k).toContain('secrets not configured');
    }
  });

  it('a range wholly before the beacon is a measured zero and never asks Cloudflare', async () => {
    expect(await readTraffic({ preset: 'custom', from: '2026-10-01', to: '2026-10-28' })).toEqual(EMPTY_TRAFFIC);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('a range ending on the beacon day itself is measured: Cloudflare is asked', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: { viewer: { accounts: [{ daily: [], pages: [], referrers: [] }] } } }) });
    expect(await readTraffic({ preset: 'custom', from: '2026-10-28', to: TRAFFIC_SINCE })).toEqual(EMPTY_TRAFFIC);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a straddling range asks Cloudflare from the beacon day on', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: { viewer: { accounts: [{ daily: [], pages: [], referrers: [] }] } } }) });
    await readTraffic({ preset: '30d', from: '2026-10-01', to: '2026-10-30' });
    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect((JSON.parse(init.body) as { variables: { geq: string } }).variables.geq).toBe(`${TRAFFIC_SINCE}T00:00:00Z`);
  });

  it('is null when Cloudflare answers with data AND errors, and when the account list is empty', async () => {
    const account = { daily: [row({ date: '2026-10-23' }, 3, 1)], pages: [], referrers: [] };
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: { viewer: { accounts: [account] } }, errors: [{ message: 'x' }] }) });
    expect(await readTraffic(range)).toBeNull();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: { viewer: { accounts: [] } } }) });
    expect(await readTraffic(range)).toBeNull();
  });

  it('sends the token only as a bearer header and the tags only as variables', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: { viewer: { accounts: [{ daily: [], pages: [], referrers: [] }] } } }) });
    expect(await readTraffic(range)).toEqual({ visits: 0, pageViews: 0, daily: [], topPages: [], topReferrers: [] });
    const [, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
    expect(init.headers.Authorization).toBe('Bearer secret-token-value');
    const body = JSON.parse(init.body) as { query: string; variables: Record<string, unknown> };
    expect(body.variables).toMatchObject({ accountTag: 'acct', siteTag: 'site' });
    expect(body.query).not.toContain('secret-token-value');
  });

  it('is null on an HTTP error, on GraphQL errors and on a network failure, and the token never reaches the log', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
    expect(await readTraffic(range)).toBeNull();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ errors: [{ message: 'bad query' }] }) });
    expect(await readTraffic(range)).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    expect(await readTraffic(range)).toBeNull();
    expect(logger.error).toHaveBeenCalledTimes(3);
    expect(loggedText()).toContain('401');
    expect(loggedText()).toContain('bad query');
    expect(loggedText()).not.toContain('secret-token-value');
  });
});
