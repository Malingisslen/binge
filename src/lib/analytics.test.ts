import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as mod from './analytics';
import type { AnalyticsEvent } from './analytics';

// Mockat test: bevisar vad klienten SKICKAR till recordEvent och när. Det utvärderar inte
// serverns ordförråd — det gör functions/src/eventStats/logic.test.ts.
const getAppCheckToken = vi.fn<() => Promise<string | null>>();
vi.mock('@/lib/firebase/appCheck', () => ({ getAppCheckToken: () => getAppCheckToken() }));

const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();

/** Låter de lata importerna i send() och anropet bli klara. */
async function settle() {
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await vi.dynamicImportSettled();
  }
}

const requests = () => fetchMock.mock.calls.map(([url, init]) => ({ url, init }));
const sentEvents = () =>
  requests().map((r) => (JSON.parse(r.init.body as string) as { data: { events: { name: string }[] } }).data.events);

beforeEach(() => {
  vi.useFakeTimers();
  getAppCheckToken.mockReset().mockResolvedValue('app-check-token');
  fetchMock.mockReset().mockResolvedValue(new Response('{"result":{"ok":true}}'));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => {
  // Modulens kö och timer lever mellan testen: töm dem så nästa test börjar rent.
  window.dispatchEvent(new Event('pagehide'));
  await settle();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('trackEvent — samlar och skickar till recordEvent', () => {
  it('skickar ingenting direkt, och allt samlat i ett anrop efter FLUSH_INTERVAL_MS', async () => {
    mod.trackEvent('share_clicked', { surface: 'title', method: 'copy' });
    mod.trackEvent('provider_clicked', { providerId: 8, offerType: 'rent', mediaType: 'movie' });
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(mod.FLUSH_INTERVAL_MS);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentEvents()[0]).toEqual([
      { name: 'share_clicked', props: { surface: 'title', method: 'copy' } },
      { name: 'provider_clicked', props: { providerId: 8, offerType: 'rent', mediaType: 'movie' } },
    ]);
  });

  it('högst MAX_EVENTS_PER_CALL per anrop; resten går i nästa omgång, inte i samma stund', async () => {
    for (let i = 0; i < mod.MAX_EVENTS_PER_CALL + 5; i++) mod.trackEvent('signed_up');
    await vi.advanceTimersByTimeAsync(mod.FLUSH_INTERVAL_MS);
    await settle();
    expect(sentEvents().map((e) => e.length)).toEqual([mod.MAX_EVENTS_PER_CALL]);

    await vi.advanceTimersByTimeAsync(mod.FLUSH_INTERVAL_MS);
    await settle();
    expect(sentEvents().map((e) => e.length)).toEqual([mod.MAX_EVENTS_PER_CALL, 5]);
  });

  it('pagehide skickar kön direkt, i omgångar om högst MAX_EVENTS_PER_CALL', async () => {
    for (let i = 0; i < mod.MAX_EVENTS_PER_CALL + 1; i++) mod.trackEvent('title_added_watchlist', { mediaType: 'tv', status: 'mina' });
    window.dispatchEvent(new Event('pagehide'));
    await settle();
    expect(sentEvents().map((e) => e.length)).toEqual([mod.MAX_EVENTS_PER_CALL, 1]);

    // Timern är rensad: ingenting skickas igen efter intervallet.
    await vi.advanceTimersByTimeAsync(mod.FLUSH_INTERVAL_MS);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('händelser utanför COUNTED_EVENTS är no-ops och kostar inget anrop', async () => {
    mod.trackEvent('search_submitted', { resultCount: 3, mediaFilter: 'all' });
    mod.trackEvent('status_changed', { mediaType: 'tv', status: 'mina' });
    await vi.advanceTimersByTimeAsync(mod.FLUSH_INTERVAL_MS);
    window.dispatchEvent(new Event('pagehide'));
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();

    // Kontroll: samma väg skickar en räknad händelse, så tystnaden ovan är inte en trasig mätning.
    mod.trackEvent('signed_up');
    await vi.advanceTimersByTimeAsync(mod.FLUSH_INTERVAL_MS);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ett misslyckat anrop sväljs — inget kast, och nästa omgång skickas ändå', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    mod.trackEvent('signed_up');
    await vi.advanceTimersByTimeAsync(mod.FLUSH_INTERVAL_MS);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(() => mod.trackEvent('signed_in', { method: 'google' })).not.toThrow();
    await vi.advanceTimersByTimeAsync(mod.FLUSH_INTERVAL_MS);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('accepterar varje räknad händelses form', async () => {
    const events: AnalyticsEvent[] = [
      { name: 'signed_up' },
      { name: 'signed_in', props: { method: 'email' } },
      { name: 'onboarding_completed', props: { step_reached: 3 } },
      { name: 'title_added_watchlist', props: { mediaType: 'movie', status: 'vill_se' } },
      { name: 'advisor_action_taken', props: { action: 'pause', providerId: 8 } },
      { name: 'provider_clicked', props: { providerId: 8, offerType: 'subscription', mediaType: 'tv' } },
      { name: 'share_clicked', props: { surface: 'list', method: 'native' } },
      { name: 'price_check_total_shown', props: { surface: 'home', paidCount: 2 } },
      { name: 'price_check_save_clicked', props: { paidCount: 2 } },
    ];
    for (const e of events) mod.trackEvent(e.name, e.props as never);
    await vi.advanceTimersByTimeAsync(mod.FLUSH_INTERVAL_MS);
    await settle();
    expect(sentEvents()[0].map((e) => e.name)).toEqual(events.map((e) => e.name));
    expect(new Set(events.map((e) => e.name))).toEqual(new Set(mod.COUNTED_EVENTS));
  });

  it('anropet bär App Check men ingen Authorization, med keepalive och anropbar-protokollets kropp', async () => {
    mod.trackEvent('signed_up');
    await vi.advanceTimersByTimeAsync(mod.FLUSH_INTERVAL_MS);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { url, init } = requests()[0];
    expect(url).toMatch(/\/recordEvent$/);
    expect(url).toMatch(/europe-west1/);
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
    const headers = new Headers(init.headers);
    expect(headers.get('X-Firebase-AppCheck')).toBe('app-check-token');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.has('Authorization')).toBe(false);
    expect(JSON.parse(init.body as string)).toEqual({ data: { events: [{ name: 'signed_up' }] } });
  });

  it('utan App Check-token skickas ingenting, och nästa omgång med token går iväg', async () => {
    getAppCheckToken.mockResolvedValueOnce(null);
    mod.trackEvent('signed_up');
    await vi.advanceTimersByTimeAsync(mod.FLUSH_INTERVAL_MS);
    await settle();
    expect(getAppCheckToken).toHaveBeenCalledTimes(1); // mätningen nådde token-steget
    expect(fetchMock).not.toHaveBeenCalled();

    mod.trackEvent('signed_up');
    await vi.advanceTimersByTimeAsync(mod.FLUSH_INTERVAL_MS);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
