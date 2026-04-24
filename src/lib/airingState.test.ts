import { describe, it, expect } from 'vitest';
import { airingState, isOngoing, isEndedStatus } from './airingState';

describe('airingState', () => {
  describe('ongoing statuses', () => {
    it('maps "Returning Series" to ongoing', () => {
      expect(airingState('Returning Series')).toBe('ongoing');
    });
    it('maps "In Production" to ongoing', () => {
      expect(airingState('In Production')).toBe('ongoing');
    });
    it('maps "Planned" to ongoing', () => {
      expect(airingState('Planned')).toBe('ongoing');
    });
    it('is case-insensitive for ongoing statuses', () => {
      expect(airingState('returning series')).toBe('ongoing');
      expect(airingState('RETURNING SERIES')).toBe('ongoing');
    });
  });

  describe('ended statuses', () => {
    it('maps "Ended" to ended', () => {
      expect(airingState('Ended')).toBe('ended');
    });
    it('maps "Canceled" to ended (US spelling)', () => {
      expect(airingState('Canceled')).toBe('ended');
    });
    it('maps "Cancelled" to ended (UK spelling)', () => {
      expect(airingState('Cancelled')).toBe('ended');
    });
    it('maps "Pilot" to ended', () => {
      expect(airingState('Pilot')).toBe('ended');
    });
  });

  describe('unknown / edge cases', () => {
    it('returns unknown for null', () => {
      expect(airingState(null)).toBe('unknown');
    });
    it('returns unknown for undefined', () => {
      expect(airingState(undefined)).toBe('unknown');
    });
    it('returns unknown for empty string', () => {
      expect(airingState('')).toBe('unknown');
    });
    it('returns unknown for "Rumored" (TMDB allows it but we don\'t classify)', () => {
      expect(airingState('Rumored')).toBe('unknown');
    });
    it('returns unknown for unexpected strings', () => {
      expect(airingState('Something Else')).toBe('unknown');
    });
  });

  describe('isOngoing', () => {
    it('returns true only for ongoing', () => {
      expect(isOngoing('Returning Series')).toBe(true);
      expect(isOngoing('Ended')).toBe(false);
      expect(isOngoing(null)).toBe(false);
    });
  });

  describe('isEndedStatus', () => {
    it('returns true only for ended', () => {
      expect(isEndedStatus('Ended')).toBe(true);
      expect(isEndedStatus('Canceled')).toBe(true);
      expect(isEndedStatus('Returning Series')).toBe(false);
      expect(isEndedStatus(null)).toBe(false);
    });
  });
});
