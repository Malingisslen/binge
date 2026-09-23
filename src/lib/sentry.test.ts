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
  request?: { url?: string; headers?: Record<string, string> };
  transaction?: string;
};
type Crumb = { category?: string; data?: Record<string, unknown> };
type InitOptions = {
  dsn: string;
  environment: string;
  release: string;
  tracesSampleRate: number;
  beforeSend: (event: ScrubEvent) => ScrubEvent | null;
  beforeBreadcrumb: (crumb: Crumb) => Crumb | null;
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
    // BIN-1283: the id goes too — the privacy page promises it.
    expect(scrubbed!.user).toEqual({});
    expect(scrubbed!.request!.url).toBe('https://binge.nu/movie/603/');
  });

  // BIN-1283: the page address itself carried a username, or the link that opens
  // a Tillsammans session, to a processor in the US.
  it('beforeSend replaces the id segment of every dynamic route, in the url and the transaction', async () => {
    const { initSentry } = await loadSentry('https://key@o1.ingest.sentry.io/2');
    await initSentry();

    const cases: [string, string][] = [
      ['https://binge.nu/user/malin/?tab=reviews', 'https://binge.nu/user/:username/'],
      ['https://binge.nu/tillsammans/abc123/', 'https://binge.nu/tillsammans/:session/'],
      ['https://binge.nu/grupper/g1/#hushall', 'https://binge.nu/grupper/:group/'],
      ['https://binge.nu/list/l9/', 'https://binge.nu/list/:list/'],
    ];
    for (const [raw, expected] of cases) {
      const scrubbed = initOptions().beforeSend({ request: { url: raw }, transaction: new URL(raw).pathname });
      expect(scrubbed!.request!.url).toBe(expected);
      expect(scrubbed!.transaction).toBe(new URL(expected).pathname);
    }
  });

  // The SDK copies document.referrer into the request headers, and the site's
  // Referrer-Policy sends the full same-origin path.
  it('beforeSend scrubs the Referer header the same way', async () => {
    const { initSentry } = await loadSentry('https://key@o1.ingest.sentry.io/2');
    await initSentry();

    const scrubbed = initOptions().beforeSend({
      request: { url: 'https://binge.nu/movie/603/', headers: { Referer: 'https://binge.nu/user/malin/?tab=x', 'User-Agent': 'ua' } },
    });
    expect(scrubbed!.request!.headers).toEqual({ Referer: 'https://binge.nu/user/:username/', 'User-Agent': 'ua' });
  });

  it('beforeSend scrubs frame filenames and Firestore paths in exception text', async () => {
    const { initSentry } = await loadSentry('https://key@o1.ingest.sentry.io/2');
    await initSentry();

    const event = {
      exception: {
        values: [{
          value: 'No document to update: projects/binge-nu/databases/(default)/documents/groups/g1/members/uid-42',
          stacktrace: { frames: [{ filename: 'https://binge.nu/tillsammans/abc123/?x=1', abs_path: '/user/malin/' }] },
        }],
      },
    };
    const scrubbed = initOptions().beforeSend(event as ScrubEvent) as typeof event;
    expect(scrubbed.exception.values[0].value)
      .toBe('No document to update: projects/binge-nu/databases/(default)/documents/groups/:id/members/:id');
    expect(scrubbed.exception.values[0].stacktrace.frames[0]).toEqual({
      filename: 'https://binge.nu/tillsammans/:session/',
      abs_path: '/user/:username/',
    });
  });

  // The SDK's validation error names the document without the `documents/` prefix.
  it('beforeSend scrubs the SDK validation message shape too', async () => {
    const { initSentry } = await loadSentry('https://key@o1.ingest.sentry.io/2');
    await initSentry();

    const event = { exception: { values: [{
      value: 'Function setDoc() called with invalid data. Unsupported field value: undefined (found in field note in document users/uid-7/watchlist/movie_1)',
    }] } };
    const scrubbed = initOptions().beforeSend(event as ScrubEvent) as typeof event;
    expect(scrubbed.exception.values[0].value).toBe(
      'Function setDoc() called with invalid data. Unsupported field value: undefined (found in field note in document users/:id/watchlist/:id)',
    );
  });

  it('beforeSend scrubs Firestore paths in a plain event message', async () => {
    const { initSentry } = await loadSentry('https://key@o1.ingest.sentry.io/2');
    await initSentry();

    const scrubbed = initOptions().beforeSend({ message: 'failed at documents/groups/g1/members/uid-42' } as ScrubEvent) as { message: string };
    expect(scrubbed.message).toBe('failed at documents/groups/:id/members/:id');
  });

  // A `sentry.event` crumb carries an EARLIER event's error text.
  it('beforeBreadcrumb scrubs Firestore paths in a non-UI crumb message', async () => {
    const { initSentry } = await loadSentry('https://key@o1.ingest.sentry.io/2');
    await initSentry();

    const crumb = initOptions().beforeBreadcrumb({
      category: 'sentry.event',
      message: 'No document to update: projects/p/databases/(default)/documents/users/uid-1/watchlist/movie_603',
    } as Crumb) as Crumb & { message?: string };
    expect(crumb.message).toBe('No document to update: projects/p/databases/(default)/documents/users/:id/watchlist/:id');
  });

  it('beforeBreadcrumb drops the text of every ui crumb, not only clicks', async () => {
    const { initSentry } = await loadSentry('https://key@o1.ingest.sentry.io/2');
    await initSentry();

    const input = initOptions().beforeBreadcrumb({
      category: 'ui.input', message: 'input[aria-label="Namn"]',
    } as Crumb) as Crumb & { message?: string };
    expect(input.message).toBeUndefined();
  });

  it('beforeBreadcrumb drops console lines and the text of a click', async () => {
    const { initSentry } = await loadSentry('https://key@o1.ingest.sentry.io/2');
    await initSentry();

    expect(initOptions().beforeBreadcrumb({ category: 'console', data: { arguments: ['[group-progress-sync]', 'g1'] } })).toBeNull();
    const click = initOptions().beforeBreadcrumb({
      category: 'ui.click', message: 'button[aria-label="Kontomeny (Malin G)"]',
    } as Crumb) as Crumb & { message?: string };
    expect(click).not.toBeNull();
    expect(click.message).toBeUndefined();
  });

  it('leaves the create pages and ordinary routes as they are', async () => {
    const { scrubUrlPath } = await loadSentry('');
    expect(scrubUrlPath('/tillsammans/ny/')).toBe('/tillsammans/ny/');
    expect(scrubUrlPath('/grupper/ny/')).toBe('/grupper/ny/');
    expect(scrubUrlPath('/movie/603/')).toBe('/movie/603/');
    expect(scrubUrlPath('/user/')).toBe('/user/');
  });

  it('beforeBreadcrumb scrubs navigation from/to and a request url', async () => {
    const { initSentry } = await loadSentry('https://key@o1.ingest.sentry.io/2');
    await initSentry();

    const nav = initOptions().beforeBreadcrumb({
      category: 'navigation',
      data: { from: '/user/malin/', to: '/tillsammans/abc123/?x=1' },
    });
    expect(nav!.data).toEqual({ from: '/user/:username/', to: '/tillsammans/:session/' });

    const fetchCrumb = initOptions().beforeBreadcrumb({
      category: 'fetch',
      data: { url: 'https://binge.nu/grupper/g1/?invite=secret', status_code: 200 },
    });
    expect(fetchCrumb!.data).toEqual({ url: 'https://binge.nu/grupper/:group/', status_code: 200 });

    // A crumb without data is passed through, not dropped.
    expect(initOptions().beforeBreadcrumb({ category: 'sentry.event' })).toEqual({ category: 'sentry.event' });
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
