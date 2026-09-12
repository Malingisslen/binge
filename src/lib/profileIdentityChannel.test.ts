import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PROFILE_IDENTITY_CHANNEL,
  parseProfileIdentityMessage,
  openProfileIdentityChannel,
} from './profileIdentityChannel';

// A real bus between channel objects, with the one semantic the production code
// leans on: a channel never delivers to the object that posted.
class FakeBroadcastChannel {
  static open: FakeBroadcastChannel[] = [];
  closed = false;
  private listeners: ((e: MessageEvent) => void)[] = [];
  constructor(public name: string) { FakeBroadcastChannel.open.push(this); }
  addEventListener(_type: string, cb: (e: MessageEvent) => void) { this.listeners.push(cb); }
  removeEventListener(_type: string, cb: (e: MessageEvent) => void) {
    this.listeners = this.listeners.filter(l => l !== cb);
  }
  postMessage(data: unknown) {
    for (const other of FakeBroadcastChannel.open) {
      if (other === this || other.closed || other.name !== this.name) continue;
      other.listeners.forEach(l => l({ data } as MessageEvent));
    }
  }
  close() {
    this.closed = true;
    FakeBroadcastChannel.open = FakeBroadcastChannel.open.filter(c => c !== this);
  }
}

const original = (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;

beforeEach(() => {
  FakeBroadcastChannel.open = [];
  (window as unknown as { BroadcastChannel: unknown }).BroadcastChannel = FakeBroadcastChannel;
});
afterEach(() => {
  (window as unknown as { BroadcastChannel: unknown }).BroadcastChannel = original;
});

const VALID = { uid: 'u1', displayName: 'Malin', username: 'malin' };

describe('parseProfileIdentityMessage — nyckeluppsättningen är STÄNGD', () => {
  it('tar emot exakt de tre fälten', () => {
    expect(parseProfileIdentityMessage(VALID)).toEqual(VALID);
  });

  it('tillåter ett saknat användarnamn som null', () => {
    expect(parseProfileIdentityMessage({ ...VALID, username: null }))
      .toEqual({ ...VALID, username: null });
  });

  // Den avgörande riktningen. En parser som IGNORERAR extra fält hade sluppit
  // igenom en framtida vidgning av nyttolasten utan att någon beslutade den —
  // vilket är precis vad #4, #5 och #6 blockerade på, var för sig.
  it('vägrar ett meddelande med ett FJÄRDE fält i stället för att trimma det', () => {
    expect(parseProfileIdentityMessage({ ...VALID, photoURL: null })).toBeNull();
    expect(parseProfileIdentityMessage({ ...VALID, bio: 'hej' })).toBeNull();
    expect(parseProfileIdentityMessage({ ...VALID, email: 'a@b.se' })).toBeNull();
  });

  it('vägrar ett meddelande där något av de tre saknas', () => {
    expect(parseProfileIdentityMessage({ uid: 'u1', displayName: 'Malin' })).toBeNull();
    expect(parseProfileIdentityMessage({ uid: 'u1', username: 'malin' })).toBeNull();
    expect(parseProfileIdentityMessage({ displayName: 'Malin', username: 'malin' })).toBeNull();
  });

  it('vägrar fel typer och ett tomt uid', () => {
    expect(parseProfileIdentityMessage({ ...VALID, uid: '' })).toBeNull();
    expect(parseProfileIdentityMessage({ ...VALID, uid: 7 })).toBeNull();
    expect(parseProfileIdentityMessage({ ...VALID, displayName: null })).toBeNull();
    expect(parseProfileIdentityMessage({ ...VALID, username: 7 })).toBeNull();
  });

  it('vägrar sådant som inte ens är ett objekt', () => {
    for (const raw of [null, undefined, 'Malin', 42, [VALID]]) {
      expect(parseProfileIdentityMessage(raw)).toBeNull();
    }
  });
});

describe('openProfileIdentityChannel', () => {
  it('levererar till en annan flik men aldrig till sig själv', () => {
    const mine: unknown[] = [];
    const theirs: unknown[] = [];
    const a = openProfileIdentityChannel(m => mine.push(m));
    const b = openProfileIdentityChannel(m => theirs.push(m));

    a.post(VALID);

    expect(mine).toHaveLength(0);
    expect(theirs).toEqual([VALID]);
    a.close();
    b.close();
  });

  it('släpper inte igenom ett meddelande som inte har rätt form', () => {
    const received: unknown[] = [];
    const a = openProfileIdentityChannel(() => {});
    const b = openProfileIdentityChannel(m => received.push(m));

    // Posta förbi typningen, som en främmande skribent på samma kanalnamn skulle.
    (a as unknown as { post: (m: unknown) => void }).post({ ...VALID, photoURL: null });

    expect(received).toHaveLength(0);
    a.close();
    b.close();
  });

  it('slutar lyssna och stänger handtaget vid close()', () => {
    const received: unknown[] = [];
    const a = openProfileIdentityChannel(() => {});
    const b = openProfileIdentityChannel(m => received.push(m));

    b.close();
    a.post(VALID);

    expect(received).toHaveLength(0);
    expect(FakeBroadcastChannel.open.some(c => c.name === PROFILE_IDENTITY_CHANNEL && !c.closed))
      .toBe(true); // a lever fortfarande
    a.close();
    expect(FakeBroadcastChannel.open).toHaveLength(0);
  });

  // En miljö utan API:et får inte krascha appen: det förbefintliga beteendet
  // (fliken är inaktuell tills den laddas om) är självläkande och acceptabelt.
  it('ger ett verkningslöst handtag när BroadcastChannel saknas', () => {
    (window as unknown as { BroadcastChannel: unknown }).BroadcastChannel = undefined;
    const handle = openProfileIdentityChannel(() => { throw new Error('får inte anropas'); });
    expect(() => handle.post(VALID)).not.toThrow();
    expect(() => handle.close()).not.toThrow();
  });

  it('ger ett verkningslöst handtag när konstruktorn kastar', () => {
    (window as unknown as { BroadcastChannel: unknown }).BroadcastChannel = class {
      constructor() { throw new Error('blockerad av webbläsaren'); }
    };
    const handle = openProfileIdentityChannel(() => { throw new Error('får inte anropas'); });
    expect(() => handle.post(VALID)).not.toThrow();
    expect(() => handle.close()).not.toThrow();
  });
});

// #6 DPO, blockerande villkor 2026-09-12. ADR 0019:s "ren händelse, inte ett
// tillstånd som ska överleva" håller bara om IMPLEMENTATIONEN är minnesbunden,
// inte bara biljettexten. BIN-817 är precedensen: profilfält låg i localStorage i
// klartext, utan utgång, odeklarerade i integritetspolicyn och kvar efter en
// kontoradering. Den här kontrollen fäller varje försök att "cacha det senaste
// namnet" i den här modulen.
describe('nyttolasten når aldrig disken (BIN-817:s form)', () => {
  it('modulen rör ingen beständig lagring', () => {
    const source = readFileSync(resolve(__dirname, 'profileIdentityChannel.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const api of ['localStorage', 'sessionStorage', 'indexedDB', 'IDBFactory', 'document.cookie']) {
      expect(code).not.toContain(api);
    }
    // Golv: kommentarstrippningen får inte ha ätit hela filen, annars är
    // frånvaron ovan uppfylld av en förstörd mätning i stället för av koden.
    expect(code).toContain('postMessage');
    expect(code).toContain(PROFILE_IDENTITY_CHANNEL);
  });
});
