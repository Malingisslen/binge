import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  deletionMarkerKey,
  markDeletionStarted,
  isDeletionStarted,
  deletionStartedAt,
  clearDeletionStarted,
} from './deletionMarker';

// BIN-816 / ADR 0019 conditions 2 and 6.
//
// This marker is the only thing standing between an aborted deletion and a
// resurrected profile with a consent record dated today, so the properties
// pinned here are the ones whose failure is silent: it must be uid-scoped (a
// shared device must not inherit it), it must be re-read from storage every
// time (BIN-592's stale ref is the bug the opposite produces), and a storage
// that throws must answer "not marked" rather than locking someone out of an
// account nothing tried to delete.

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('deletionMarker', () => {
  it('är uid-scopad — en markerad användare smittar inte nästa konto på samma enhet', () => {
    markDeletionStarted('alice', 1_000);

    expect(isDeletionStarted('alice')).toBe(true);
    // Delad enhet: nästa person loggar in och ska mötas av en helt vanlig app.
    expect(isDeletionStarted('bob')).toBe(false);
  });

  it('läser om från storage varje gång — ett värde som ändras utanför processen syns direkt', () => {
    expect(isDeletionStarted('alice')).toBe(false);
    // Sätts av ett annat anrop (eller en annan flik). En implementation som
    // cachade första svaret i en modul-variabel eller en ref skulle svara
    // false för alltid här, vilket är exakt BIN-592:s fel — och här betyder
    // det en återuppstånden profil.
    window.localStorage.setItem(deletionMarkerKey('alice'), JSON.stringify({ startedAt: 5 }));
    expect(isDeletionStarted('alice')).toBe(true);
    window.localStorage.removeItem(deletionMarkerKey('alice'));
    expect(isDeletionStarted('alice')).toBe(false);
  });

  it('nyckeln är prefixad så andra binge-nycklar inte kan kollidera med den', () => {
    // Den exporterade nyckeln är vad en framtida prefix-svepning ska undanta
    // (ADR 0019 villkor 6). Prefixet får inte råka delas med clearAllInviteTokens
    // ('binge:groupInvite:'), som sveper allt med SITT prefix.
    expect(deletionMarkerKey('alice')).toBe('binge:deletionStarted:alice');
    expect(deletionMarkerKey('alice').startsWith('binge:groupInvite:')).toBe(false);
  });

  it('bär tidpunkten raderingen startade — supportens enda ledtråd på enheten', () => {
    markDeletionStarted('alice', 1_723_000_000_000);
    expect(deletionStartedAt('alice')).toBe(1_723_000_000_000);
    expect(deletionStartedAt('bob')).toBeNull();
  });

  it('ett skadat värde ger fortfarande "markerad", men ingen tidpunkt', () => {
    // Att inte kunna läsa tidsstämpeln får aldrig läsas som att markeringen är
    // borta: det är närvaron av nyckeln som spärrar skrivningarna.
    window.localStorage.setItem(deletionMarkerKey('alice'), 'inte-json');
    expect(isDeletionStarted('alice')).toBe(true);
    expect(deletionStartedAt('alice')).toBeNull();
  });

  it('rensas bara explicit — ingen ångra-väg, och den överlever en läsning', () => {
    markDeletionStarted('alice', 1_000);
    expect(isDeletionStarted('alice')).toBe(true);
    expect(isDeletionStarted('alice')).toBe(true);
    clearDeletionStarted('alice');
    expect(isDeletionStarted('alice')).toBe(false);
  });

  it('en storage som kastar svarar "inte markerad" — aldrig tvärtom', () => {
    // Asymmetrin är hela poängen och den är MOTSATT tabSession:s. Ett falskt
    // true låser ute någon vars konto ingen försökt radera; ett falskt false
    // kostar bara dagens beteende.
    //
    // Här stod "och serversopningen fångar det". Det var falskt och är struket
    // 2026-08-15 (BIN-879 / ADR 0022) — samma rättelse som i modulens egen
    // header. Ett falskt false släpper igenom en spärrad skrivning,
    // `ensureUserProfile` återskapar `users/{uid}`, och kontot lämnar då
    // sopningens urval PERMANENT, eftersom sopningen letar efter konton utan
    // profil. Sopningen är backstop för den som aldrig återvänder någonstans,
    // inte för det här. Återinför inte meningen.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: private mode');
    });
    expect(isDeletionStarted('alice')).toBe(false);
    expect(deletionStartedAt('alice')).toBeNull();
  });

  it('en storage som kastar vid skrivning kraschar inte raderingen', () => {
    // markDeletionStarted ligger mitt i deleteAccount. Kastar den avbryts
    // raderingen av ett skydd som bara var best-effort från början.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => markDeletionStarted('alice', 1_000)).not.toThrow();
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => clearDeletionStarted('alice')).not.toThrow();
  });
});
