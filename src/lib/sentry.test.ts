import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// BIN-657 made initSentry() return a Promise so global-error.tsx — the LAST
// error boundary, which renders without Providers and therefore without a
// previous init — can await the lazy SDK load before reporting the crash that
// got it mounted. global-error.test.tsx module-mocks '@/lib/sentry' wholesale,
// so it only pins that component's orchestration; nothing exercised the real
// implementation whose contract changed. Breaking the no-DSN branch to return
// `undefined` instead of a resolved promise left the entire suite green, while
// in production it throws `undefined.then is not a function` synchronously
// inside the crash boundary's own recovery effect.
//
// So this file mocks ONLY the documented choke point (@sentry/react) and drives
// the real module. DSN is read at module scope, so each case stubs the env and
// re-imports through vi.resetModules() to get fresh module state (`sentry`,
// `initPromise`).

const h = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock('@sentry/react', () => ({ init: h.init, captureException: h.captureException }));

type ScrubEvent = {
  user?: { id?: string; email?: string; username?: string; ip_address?: string };
  request?: { url?: string };
};
type InitOptions = {
  dsn: string;
  environment: string;
  release: string;
  tracesSampleRate: number;
  beforeSend: (event: ScrubEvent) => ScrubEvent | null;
};

async function loadSentry(dsn: string) {
  vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', dsn);
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'test-env');
  vi.stubEnv('NEXT_PUBLIC_GIT_SHA', 'deadbee');
  vi.resetModules();
  return import('./sentry');
}

function initOptions(): InitOptions {
  return h.init.mock.calls[0][0] as InitOptions;
}

describe('initSentry — the lazy-load contract global-error.tsx depends on', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    h.init.mockReset();
    h.captureException.mockReset();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    vi.unstubAllEnvs();
  });

  it('resolves — not returns undefined — when there is no DSN, and stays a no-op', async () => {
    const { initSentry, captureError } = await loadSentry('');

    const returned = initSentry();
    // The whole point of the Promise return: a caller may `.then()` it
    // unconditionally. `undefined` here crashes the boundary that awaits it.
    expect(typeof returned?.then).toBe('function');
    await expect(returned).resolves.toBeUndefined();

    expect(h.init).not.toHaveBeenCalled();
    captureError(new Error('boom'), { scope: 'test' });
    expect(h.captureException).not.toHaveBeenCalled();
  });

  it('initialises the SDK once and only reports AFTER the returned promise settles', async () => {
    const { initSentry, captureError } = await loadSentry('https://key@o1.ingest.sentry.io/2');

    const loading = initSentry();
    // Still loading: captureError must no-op rather than throw. This is exactly
    // why global-error.tsx awaits instead of firing and forgetting.
    captureError(new Error('too early'), { scope: 'test' });
    expect(h.captureException).not.toHaveBeenCalled();

    await loading;

    expect(h.init).toHaveBeenCalledTimes(1);
    expect(initOptions()).toMatchObject({
      dsn: 'https://key@o1.ingest.sentry.io/2',
      environment: 'test-env',
      release: 'deadbee',
      tracesSampleRate: 0, // performance sampling stays off — it is billed
    });

    captureError(new Error('boom'), { scope: 'app:global', kind: 'error-boundary', extra: { digest: 'd1' } });
    expect(h.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { scope: 'app:global', kind: 'error-boundary' },
      extra: { digest: 'd1' },
    });

    // Second call must reuse the in-flight/settled promise, not re-init the SDK.
    await initSentry();
    expect(h.init).toHaveBeenCalledTimes(1);
  });

  it('beforeSend strips PII from the user block and the query string off the URL', async () => {
    const { initSentry } = await loadSentry('https://key@o1.ingest.sentry.io/2');
    await initSentry();

    const event: ScrubEvent = {
      user: { id: 'uid-1', email: 'malin@example.com', username: 'malin', ip_address: '81.2.3.4' },
      request: { url: 'https://binge.nu/movie/603/?token=secret&q=matrix' },
    };

    const scrubbed = initOptions().beforeSend(event);

    expect(scrubbed).not.toBeNull();
    expect(scrubbed!.user).toEqual({ id: 'uid-1' });
    expect(scrubbed!.request!.url).toBe('https://binge.nu/movie/603/');
  });

  it('beforeSend leaves a non-URL request url alone instead of dropping the event', async () => {
    const { initSentry } = await loadSentry('https://key@o1.ingest.sentry.io/2');
    await initSentry();

    const scrubbed = initOptions().beforeSend({ request: { url: 'not-a-url' } });

    expect(scrubbed).not.toBeNull();
    expect(scrubbed!.request!.url).toBe('not-a-url');
  });

  it('warns and allows a retry when the SDK load fails', async () => {
    // The failure is injected at S.init rather than at the dynamic import
    // because vitest caches a rejected module and the retry could never
    // succeed — same catch branch either way, which is what is under test.
    h.init.mockImplementationOnce(() => { throw new Error('adblocker ate the chunk'); });
    const { initSentry, captureError } = await loadSentry('https://key@o1.ingest.sentry.io/2');

    await initSentry();

    expect(warn).toHaveBeenCalledWith('[sentry] SDK-laddning misslyckades:', expect.any(Error));
    captureError(new Error('boom'), { scope: 'test' });
    expect(h.captureException).not.toHaveBeenCalled();

    // initPromise was reset in the catch, so a later call genuinely retries.
    await initSentry();
    expect(h.init).toHaveBeenCalledTimes(2);
    captureError(new Error('boom'), { scope: 'test' });
    expect(h.captureException).toHaveBeenCalledTimes(1);
  });
});
