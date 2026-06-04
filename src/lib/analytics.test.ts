import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { trackEvent, type AnalyticsEvent } from './analytics';

describe('trackEvent', () => {
  beforeEach(() => { (window as unknown as { plausible?: unknown }).plausible = vi.fn(); });
  afterEach(() => { delete (window as unknown as { plausible?: unknown }).plausible; vi.restoreAllMocks(); });

  it('forwards name + props to window.plausible', () => {
    const spy = window.plausible as ReturnType<typeof vi.fn>;
    trackEvent('providers_selected', { count: 3 });
    expect(spy).toHaveBeenCalledWith('providers_selected', { props: { count: 3 } });
  });
  it('is a no-op when window.plausible is absent', () => {
    delete (window as unknown as { plausible?: unknown }).plausible;
    expect(() => trackEvent('advisor_viewed', { providerCount: 2 })).not.toThrow();
  });
  it('accepts each of the six new event shapes', () => {
    const spy = window.plausible as ReturnType<typeof vi.fn>;
    const events: AnalyticsEvent[] = [
      { name: 'providers_selected', props: { count: 4 } },
      { name: 'advisor_viewed', props: { providerCount: 2 } },
      { name: 'advisor_action_taken', props: { action: 'pause', providerId: 8 } },
      { name: 'search_submitted', props: { resultCount: 12, mediaFilter: 'all' } },
      { name: 'status_changed', props: { mediaType: 'tv', status: 'mina' } },
      { name: 'error_boundary_triggered', props: { scope: 'app:movie' } },
    ];
    for (const e of events) trackEvent(e.name, e.props as never);
    expect(spy).toHaveBeenCalledTimes(events.length);
  });
});
