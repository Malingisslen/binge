import { describe, it, expect, beforeEach, vi } from 'vitest';
import { safeNextPath, rememberNextPath, takeNextPath, stripUnsafeQuery, isSignInPath } from './nextPath';

// BIN-645 — where to return to after sign-in. The path rides in sessionStorage
// rather than a ?next= query param, because a query would travel to Firebase's
// Google-hosted auth handler (disclosing which title she was reading) and would
// be attacker-supplied (a crafted link could aim the landing at, say, a group
// invite that auto-joins on mount). Storage is same-origin and unwritable from
// elsewhere — but it is still writable by our OWN scripts and outlives the tap,
// so the value is validated on read as well as on write.

describe('safeNextPath', () => {
  it('accepts a same-origin absolute path, query and hash included', () => {
    expect(safeNextPath('/movie/603/')).toBe('/movie/603/');
    expect(safeNextPath('/my/series?status=behind')).toBe('/my/series?status=behind');
    expect(safeNextPath('/guider/#topp')).toBe('/guider/#topp');
  });

  it.each([
    ['an absolute URL', 'https://evil.example'],
    ['a protocol-relative URL — the browser reads this as a HOST', '//evil.example'],
    ['a backslash variant some parsers normalise to //', '/\\evil.example'],
    ['a javascript: scheme', 'javascript:alert(1)'],
    ['a data: scheme', 'data:text/html,<script>alert(1)</script>'],
    ['a bare relative path — resolves against wherever it was clicked', 'evil.example'],
    ['an empty string', ''],
    ['nothing at all', null],
    ['a smuggled newline', '/movie/603\n/../evil'],
    ['a smuggled carriage return', '/movie/603\r/../evil'],
    // DEL is the one control character ABOVE the 0x00-0x1f range, so it needs
    // its own fixture — without it the code === 0x7f term is free to vanish.
    ['a DEL character', '/movie/603\u007f/evil'],
  ])('rejects %s', (_label, input) => {
    expect(safeNextPath(input)).toBeNull();
  });

  // Not a security property, but the one that makes the feature work: a path
  // that merely LOOKS odd must still round-trip, or signing in from a filtered
  // library view silently dumps the user on the home page.
  it('does not over-reject legitimate paths', () => {
    for (const p of ['/', '/tv/1399/sasong/2/', '/user/malin', '/search/?q=blade%20runner']) {
      expect(safeNextPath(p)).toBe(p);
    }
  });
});

describe('rememberNextPath / takeNextPath', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('round-trips a safe path', () => {
    rememberNextPath('/movie/603/');
    expect(takeNextPath()).toBe('/movie/603/');
  });

  // Single-use on purpose: a leftover value would redirect the NEXT sign-in in
  // the same tab to a stale page.
  it('is consumed by the first read', () => {
    rememberNextPath('/movie/603/');
    takeNextPath();
    expect(takeNextPath()).toBeNull();
  });

  // Assert the STORAGE, not the read. Going through takeNextPath() here would
  // pass even if the writer stored the raw value, because the reader
  // re-validates — so the writer's own guard would be free to disappear.
  it('stores nothing for an unsafe path', () => {
    rememberNextPath('//evil.example');
    expect(window.sessionStorage.getItem('binge:nextAfterLogin')).toBeNull();
  });

  // Same-origin storage is still writable by any script on our own origin, and
  // a stored value outlives the tap that set it — so the read validates too.
  // Write-side stripping is not enough: a value planted straight into storage
  // never passed the writer, and the READ is where it gets used.
  it('strips an unsafe query from a value planted directly in storage', () => {
    window.sessionStorage.setItem('binge:nextAfterLogin', '/grupper/X?invite=TOKEN');
    expect(takeNextPath()).toBe('/grupper/X');
  });
  it('rejects an unsafe value planted directly in storage', () => {
    window.sessionStorage.setItem('binge:nextAfterLogin', 'https://evil.example');
    expect(takeNextPath()).toBeNull();
  });

  // Both halves throw in private mode / with storage disabled, and each needs
  // its own case: the READ runs inside LoginPage's effect, where an uncaught
  // throw takes the whole redirect with it.
  it('survives storage being unavailable on write', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => rememberNextPath('/movie/603/')).not.toThrow();
    spy.mockRestore();
    expect(takeNextPath()).toBeNull();
  });

  it('survives storage being unavailable on read', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => takeNextPath()).not.toThrow();
    expect(takeNextPath()).toBeNull();
    spy.mockRestore();
  });
});


describe('stripUnsafeQuery — only pure VIEW state comes back with you', () => {
  // The stored path is whatever the visitor had in their address bar, and an
  // attacker can choose that by handing them a link to open before they tap.
  // ?invite= joins a group on mount with no confirmation, so an allowlist means
  // it cannot be expressed here at all — rather than relying on the group page
  // staying AuthGuard-wrapped, which is a coincidence a future diff can undo.
  it('drops an invite token, keeping the page', () => {
    expect(stripUnsafeQuery('/grupper/X?invite=TOKEN')).toBe('/grupper/X');
  });

  // Every allowlisted key needs its own fixture, or it is free to be deleted —
  // and deleting one silently drops the return path for that surface.
  it('keeps the view state a visitor would miss', () => {
    expect(stripUnsafeQuery('/search/?q=blade')).toBe('/search/?q=blade');
    // The URLs the app actually builds — WatchlistPage's ?status=behind + ?provider=,
    // and RecRow's expand link, whose `row` is a colon-joined rowKey it encodes.
    // Inventing plausible-looking ones instead would leave a fixture that keeps
    // passing after the surface it names has moved.
    expect(stripUnsafeQuery('/my/series?status=behind&provider=8'))
      .toBe('/my/series?status=behind&provider=8');
    expect(stripUnsafeQuery('/recommendations/?row=person%3A1245'))
      .toBe('/recommendations/?row=person%3A1245');
  });

  it('drops only the unknown keys from a mixed query', () => {
    expect(stripUnsafeQuery('/search/?q=blade&invite=TOKEN')).toBe('/search/?q=blade');
  });

  it('leaves a query-less path alone', () => {
    expect(stripUnsafeQuery('/movie/603/')).toBe('/movie/603/');
  });

  // End to end, through the writer — the allowlist is useless if only the
  // helper applies it.
  it('is applied by rememberNextPath, not just available to it', () => {
    rememberNextPath('/grupper/X?invite=TOKEN');
    // The STORED bytes, not takeNextPath() — the reader strips a second time, so
    // reading back would pass even with the writer's strip deleted. Same trap
    // this file warns about 60 lines up, and I walked into it anyway.
    expect(window.sessionStorage.getItem('binge:nextAfterLogin')).toBe('/grupper/X');
  });
});

// BIN-668 — the sign-in page is not a destination. The topbar's "Logga in"
// button renders on /login itself (AppShell only drops the chrome on '/'), so
// tapping it there stored '/login/' — overwriting a return path the poster badge
// had already stored, and then making LoginPage router.push itself after
// sign-in with redirectedRef already latched: a signed-in visitor stranded on
// the login form.
describe('isSignInPath — a return path that is the login page is no return path', () => {
  beforeEach(() => window.sessionStorage.clear());

  it.each([
    ['the exported trailing-slash form', '/login/'],
    ['the bare form', '/login'],
    ['with a query the allowlist would otherwise keep', '/login/?q=blade'],
    ['with a hash', '/login#top'],
    ['onboarding, which LoginPage routes to explicitly', '/onboarding/'],
  ])('recognises %s', (_label, input) => {
    expect(isSignInPath(input)).toBe(true);
  });

  it.each([
    ['the home page', '/'],
    ['a title page', '/movie/603/'],
    // Prefix-matching would swallow these; they are real destinations.
    ['a page whose route merely starts with the word', '/loginhelp/'],
    ['a nested page under a different route', '/guider/login/'],
  ])('leaves %s alone', (_label, input) => {
    expect(isSignInPath(input)).toBe(false);
  });

  // Assert the STORAGE, not the read — the reader guards a second time, so
  // reading back would pass with the writer's guard deleted.
  it('is applied by rememberNextPath, so the topbar on /login stores nothing', () => {
    rememberNextPath('/login/');
    expect(window.sessionStorage.getItem('binge:nextAfterLogin')).toBeNull();
  });

  // …and it must not clobber a path the poster badge already stored.
  it('leaves an already-remembered destination intact', () => {
    rememberNextPath('/movie/603/');
    rememberNextPath('/login/');
    expect(takeNextPath()).toBe('/movie/603/');
  });

  it('rejects a sign-in path planted directly in storage', () => {
    window.sessionStorage.setItem('binge:nextAfterLogin', '/login/');
    expect(takeNextPath()).toBeNull();
  });
});