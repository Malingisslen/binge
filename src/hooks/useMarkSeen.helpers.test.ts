import { describe, it, expect } from 'vitest';
import { shouldPromptRating } from './useMarkSeen.helpers';

describe('shouldPromptRating', () => {
  it('prompts when marking sedd with no existing rating', () => {
    expect(shouldPromptRating('sedd', null)).toBe(true);
  });

  it('does not prompt when the title already has a rating', () => {
    expect(shouldPromptRating('sedd', 4)).toBe(false);
    expect(shouldPromptRating('sedd', 0.5)).toBe(false);
    // 0 är ett giltigt (om än osannolikt) betyg — gaten använder == null,
    // inte falsy, så ett nollbetyg räknas som "redan betygsatt". Pinnar det
    // så en framtida !currentRating-refaktor inte tyst börjar nudga.
    expect(shouldPromptRating('sedd', 0)).toBe(false);
  });

  it('does not prompt for non-seen status transitions', () => {
    expect(shouldPromptRating('vill_se', null)).toBe(false);
    expect(shouldPromptRating('avbruten', null)).toBe(false);
    expect(shouldPromptRating('mina', null)).toBe(false);
  });
});
