import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Handler = (event: unknown) => void;

function loadWorker(opts: { online: boolean; cached?: Record<string, string> }) {
  const handlers: Record<string, Handler> = {};
  const store = new Map<string, Response>(
    Object.entries(opts.cached ?? {}).map(([u, body]) => [`https://binge.nu${u}`, new Response(body)]),
  );
  const cache = {
    put: async (req: Request, res: Response) => void store.set(req.url, res),
    addAll: async () => {},
    keys: async () => [...store.keys()].map((u) => new Request(u)),
    delete: async (req: Request) => store.delete(req.url),
  };
  const caches = {
    open: async () => cache,
    match: async (req: Request | string) => {
      const url = typeof req === 'string' ? `https://binge.nu${req}` : req.url;
      const hit = store.get(url);
      return hit ? hit.clone() : undefined;
    },
    keys: async () => ['binge-shell-v1'],
    delete: async () => true,
  };
  const fetchMock = vi.fn(async (req: Request) => {
    if (!opts.online) throw new TypeError('offline');
    const res = new Response(`net:${new URL(req.url).pathname}`);
    Object.defineProperty(res, 'type', { value: 'basic' });
    return res;
  });
  const self = {
    addEventListener: (type: string, h: Handler) => void (handlers[type] = h),
    location: { origin: 'https://binge.nu' },
    skipWaiting: () => {},
    clients: { claim: async () => {} },
    registration: { showNotification: () => {} },
  };
  const src = readFileSync(join(process.cwd(), 'public/firebase-messaging-sw.js'), 'utf-8');
  const firebase = { initializeApp: () => {}, messaging: () => ({ onBackgroundMessage: () => {} }) };
  new Function('self', 'importScripts', 'firebase', 'caches', 'fetch', 'Response', src)(
    self,
    () => {},
    firebase,
    caches,
    fetchMock,
    Response,
  );
  async function dispatch(path: string, init: { mode?: string; method?: string } = {}) {
    const request = Object.assign(new Request(path.startsWith('http') ? path : `https://binge.nu${path}`, { method: init.method ?? 'GET' }), {});
    Object.defineProperty(request, 'mode', { value: init.mode ?? 'no-cors' });
    let responded: Promise<Response> | undefined;
    handlers.fetch({ request, respondWith: (p: Promise<Response>) => (responded = p) });
    return responded ? await (await responded).text() : undefined;
  }
  return { dispatch, fetchMock, store };
}

describe('offline-läge i service workern (BIN-1497)', () => {
  it('serverar den cachade sidan när nätet saknas', async () => {
    const w = loadWorker({ online: false, cached: { '/my/all/': 'cached-page' } });
    expect(await w.dispatch('/my/all/', { mode: 'navigate' })).toBe('cached-page');
  });

  it('faller tillbaka på skalet för en film som aldrig besökts', async () => {
    const w = loadWorker({ online: false, cached: { '/_/index.html': 'movie-shell' } });
    expect(await w.dispatch('/movie/123', { mode: 'navigate' })).toBe('movie-shell');
  });

  it.each(['tillsammans', 'grupper', 'list', 'user'])('faller tillbaka på eget skal för /%s/', async (prefix) => {
    const w = loadWorker({ online: false, cached: { [`/${prefix}/_/index.html`]: `${prefix}-shell`, '/': 'home-shell' } });
    expect(await w.dispatch(`/${prefix}/abc`, { mode: 'navigate' })).toBe(`${prefix}-shell`);
  });

  it('faller tillbaka på startsidan för övriga okända sidor', async () => {
    const w = loadWorker({ online: false, cached: { '/': 'home-shell' } });
    expect(await w.dispatch('/settings/', { mode: 'navigate' })).toBe('home-shell');
  });

  it('föredrar nätet när det finns och sparar svaret', async () => {
    const w = loadWorker({ online: true, cached: { '/my/all/': 'old' } });
    expect(await w.dispatch('/my/all/', { mode: 'navigate' })).toBe('net:/my/all/');
    await new Promise((r) => setTimeout(r, 0));
    expect(await (await w.store.get('https://binge.nu/my/all/')!.clone()).text()).toBe('net:/my/all/');
  });

  it('serverar hashade JS-filer från cachen utan nätanrop', async () => {
    const w = loadWorker({ online: true, cached: { '/_next/static/a.js': 'js' } });
    expect(await w.dispatch('/_next/static/a.js')).toBe('js');
    expect(w.fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['inloggning', '/__/auth/handler'],
    ['eget API', '/api/insights'],
  ])('rör aldrig %s', async (_name, path) => {
    const w = loadWorker({ online: true });
    expect(await w.dispatch(path)).toBeUndefined();
  });

  it('rör aldrig skrivande anrop', async () => {
    const w = loadWorker({ online: true });
    expect(await w.dispatch('/my/all/', { method: 'POST' })).toBeUndefined();
  });

  it('rör aldrig andra domäner', async () => {
    const w = loadWorker({ online: true });
    expect(await w.dispatch('https://image.tmdb.org/t/p/w500/a.jpg')).toBeUndefined();
  });
});
