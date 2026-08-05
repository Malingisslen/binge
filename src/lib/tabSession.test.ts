// src/lib/tabSession.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { markTabSession, tabShowedSessionOn } from './tabSession';

// BIN-748: the marker AuthGuard consults when its very first auth verdict is
// "no session". Three behaviours are worth pinning because a reader would
// otherwise take them on faith: WHICH storage it uses (sessionStorage is per-tab
// and survives a reload — localStorage would answer for every tab on the
// origin), that it answers PER PAGE rather than as one tab-wide flag (that is
// what makes it immune to when a lazily-mounted guard reads it), and which way
// it fails when storage refuses to answer.
const KEY = 'binge:tabSession';

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe('tabSession', () => {
  it('starts unmarked and then answers for the marked page', () => {
    expect(tabShowedSessionOn('/grupper/g1')).toBe(false);

    markTabSession('/grupper/g1');
    expect(tabShowedSessionOn('/grupper/g1')).toBe(true);
    markTabSession('/grupper/g1'); // idempotent — re-runs per navigation/verdict
    expect(tabShowedSessionOn('/grupper/g1')).toBe(true);
  });

  it('answers only for the page the session was on, never tab-wide', () => {
    // THE property the fix rests on (integrationsgranskningen 2026-08-05). A
    // tab-wide flag has to be retired at some moment, and guarded pages under
    // the catch-all router mount their guard commits later — by then a cleared
    // flag is gone and an uncleared one silences every later bounce. Comparing
    // paths needs no retirement: this is what keeps BIN-645 alive afterwards.
    markTabSession('/grupper/g1');

    expect(tabShowedSessionOn('/grupper/g1')).toBe(true);
    expect(tabShowedSessionOn('/grupper/g2')).toBe(false);
    expect(tabShowedSessionOn('/my/series')).toBe(false);
  });

  it('a later navigation moves the marker with the session', () => {
    markTabSession('/grupper/g1');
    markTabSession('/my/series');

    expect(tabShowedSessionOn('/my/series')).toBe(true);
    expect(tabShowedSessionOn('/grupper/g1'), 'the page they left is no longer the one').toBe(false);
  });

  it('ignores the trailing slash and the query on both sides', () => {
    // usePathname() (the write side) and window.location.pathname (the read
    // side) disagree about the trailing slash depending on the route, and a
    // library view whose whole state is its query would otherwise look like a
    // different page every time the filter changed.
    markTabSession('/grupper/g1/');
    expect(tabShowedSessionOn('/grupper/g1')).toBe(true);

    markTabSession('/my/all?status=sedd');
    expect(tabShowedSessionOn('/my/all?status=vill_se')).toBe(true);
  });

  it('lives in sessionStorage, never localStorage', () => {
    // Load-bearing, not a style point: localStorage is shared by every tab on
    // the origin, so a signed-in tab would mark it for a brand-new one and
    // silence that visitor's genuine bounce (the BIN-645 funnel).
    markTabSession('/grupper/g1');

    expect(window.sessionStorage.getItem(KEY)).toBe('/grupper/g1');
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('an empty stored value does not silence every page', () => {
    window.sessionStorage.setItem(KEY, '');
    expect(tabShowedSessionOn('/grupper/g1')).toBe(false);
  });

  describe('when storage refuses (private mode)', () => {
    const realStorage = Object.getOwnPropertyDescriptor(window, 'sessionStorage')!;
    const throwing = {
      getItem: () => { throw new DOMException('denied'); },
      setItem: () => { throw new DOMException('denied'); },
      removeItem: () => { throw new DOMException('denied'); },
    };

    beforeEach(() => {
      Object.defineProperty(window, 'sessionStorage', { configurable: true, get: () => throwing });
    });
    afterEach(() => {
      Object.defineProperty(window, 'sessionStorage', realStorage);
    });

    it('answers "a session was shown here" — the safe side of an unanswerable question', () => {
      // Deliberate asymmetry: guessing "bounce" wrong hands a private URL to the
      // next account on the device, guessing "handover" wrong costs a return
      // path — which this browser could not have stored anyway, since
      // rememberNextPath writes to the very storage that just threw.
      expect(tabShowedSessionOn('/grupper/g1')).toBe(true);
    });

    it('never lets a write take the app down with it', () => {
      expect(() => markTabSession('/grupper/g1')).not.toThrow();
    });
  });
});

describe('tabSession — the reload it exists for', () => {
  it('a marked tab that "reloads" still reads the marker', () => {
    // What a reload really is for this module: the module state is gone, the
    // storage is not. Re-importing proves the answer comes from storage and not
    // from a module-level variable that a real reload would have wiped.
    markTabSession('/grupper/g1');
    vi.resetModules();

    return import('./tabSession').then(fresh => {
      expect(fresh.tabShowedSessionOn('/grupper/g1')).toBe(true);
      expect(fresh.tabShowedSessionOn('/grupper/g2')).toBe(false);
    });
  });
});
