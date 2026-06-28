import { describe, it, expect } from 'vitest';
import { migrateStatus } from './watchStatus.migration';

describe('migrateStatus', () => {
  describe('schema v3 (current)', () => {
    it('passes mina through unchanged for TV', () => {
      expect(migrateStatus('mina', 'tv')).toEqual({ status: 'mina', dropped: false });
    });
    it('downgrades mina → sedd for film (L7 — film har inget mina-läge)', () => {
      expect(migrateStatus('mina', 'movie')).toEqual({ status: 'sedd', dropped: false });
    });
    it('vill_se (TV) → mina — vill_se är avskaffat för TV (2026-06)', () => {
      expect(migrateStatus('vill_se', 'tv')).toEqual({ status: 'mina', dropped: false });
    });
    it('passes vill_se (film) / sedd / avbruten unchanged', () => {
      expect(migrateStatus('vill_se', 'movie')).toEqual({ status: 'vill_se', dropped: false });
      expect(migrateStatus('sedd', 'movie')).toEqual({ status: 'sedd', dropped: false });
      expect(migrateStatus('avbruten', 'movie')).toEqual({ status: 'avbruten', dropped: false });
    });
  });

  describe('schema v2 → v3 (svenska följer/sedd → mina/sedd)', () => {
    it('följer (TV) → mina', () => {
      expect(migrateStatus('följer', 'tv')).toEqual({ status: 'mina', dropped: false });
    });
    it('följer (film) → sedd (rare, behandlas som "har sett")', () => {
      expect(migrateStatus('följer', 'movie')).toEqual({ status: 'sedd', dropped: false });
    });
    it('sedd (TV) → mina (sub-state derive:as från progress + TMDB)', () => {
      expect(migrateStatus('sedd', 'tv')).toEqual({ status: 'mina', dropped: false });
    });
    it('sedd (film) → sedd', () => {
      expect(migrateStatus('sedd', 'movie')).toEqual({ status: 'sedd', dropped: false });
    });
  });

  describe('schema v1 → v3 (engelska)', () => {
    it('watching (TV) → mina', () => {
      expect(migrateStatus('watching', 'tv')).toEqual({ status: 'mina', dropped: false });
    });
    it('watched (film) → sedd', () => {
      expect(migrateStatus('watched', 'movie')).toEqual({ status: 'sedd', dropped: false });
    });
    it('watched (TV) → mina — en real legacy Firestore-shape (BIN-332)', () => {
      // v1-docs kan bära {status:'watched', mediaType:'tv'}; TV har inget 'sedd'-
      // slutläge, så detta måste landa i 'mina' (sub-state härleds vid läsning).
      expect(migrateStatus('watched', 'tv')).toEqual({ status: 'mina', dropped: false });
    });
    it('want_to_watch (TV) → mina, (film) → vill_se', () => {
      expect(migrateStatus('want_to_watch', 'tv')).toEqual({ status: 'mina', dropped: false });
      expect(migrateStatus('want_to_watch', 'movie')).toEqual({ status: 'vill_se', dropped: false });
    });
    it('dropped → avbruten', () => {
      expect(migrateStatus('dropped', 'movie')).toEqual({ status: 'avbruten', dropped: false });
    });
  });

  describe('dropped-flag (legacy)', () => {
    it('dropped:true overrides any status to avbruten', () => {
      expect(migrateStatus('följer', 'tv', true)).toEqual({ status: 'avbruten', dropped: false });
      expect(migrateStatus('mina', 'tv', true)).toEqual({ status: 'avbruten', dropped: false });
      expect(migrateStatus('sedd', 'movie', true)).toEqual({ status: 'avbruten', dropped: false });
    });

    // BIN-35: a legacy doc carries {status:'avbruten', dropped:true} and can't be
    // revived because dropped:true wins on every read. The fix is in
    // WatchlistContext.updateStatus: setting any non-avbruten status now also
    // merge-writes dropped:false, clearing the stale flag. Once cleared, the
    // next read passes droppedFlag=false and the revived status is honored
    // instead of snapping back to 'avbruten'.
    it('once the flag is cleared (droppedFlag=false), the revived status sticks', () => {
      expect(migrateStatus('mina', 'tv', false)).toEqual({ status: 'mina', dropped: false });
      expect(migrateStatus('vill_se', 'movie', false)).toEqual({ status: 'vill_se', dropped: false });
      expect(migrateStatus('sedd', 'movie', false)).toEqual({ status: 'sedd', dropped: false });
    });
  });

  describe('idempotens', () => {
    it('är idempotent (kör 2 gånger = samma resultat)', () => {
      const once = migrateStatus('följer', 'tv');
      const twice = migrateStatus(once.status, 'tv');
      expect(twice).toEqual(once);
    });

    it('vill_se (TV) är idempotent efter migration', () => {
      const once = migrateStatus('vill_se', 'tv');
      const twice = migrateStatus(once.status, 'tv');
      expect(twice).toEqual(once);
    });
  });

  describe('okända värden', () => {
    // TV: okänd status → 'mina'. Säkert numera: mina utan progress härleds
    // till 'ej_paborjad' (inte 'aktiv' som i M2-buggen), så ingen fantom-
    // nudge uppstår. Film: → 'vill_se' (motsatsen av terminal).
    it('TV → mina (landar som ej_paborjad utan progress)', () => {
      expect(migrateStatus('garbage', 'tv')).toEqual({ status: 'mina', dropped: false });
    });
    it('film → vill_se som säker default', () => {
      expect(migrateStatus('garbage', 'movie')).toEqual({ status: 'vill_se', dropped: false });
    });
  });
});
