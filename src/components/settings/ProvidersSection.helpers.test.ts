import { describe, it, expect } from 'vitest';
import { readableTextColor } from './ProvidersSection.helpers';

describe('readableTextColor', () => {
  it('returns white on dark brand colors', () => {
    expect(readableTextColor('#E50914')).toBe('white'); // Netflix red
    expect(readableTextColor('#0063E5')).toBe('white'); // Disney+ blue
    expect(readableTextColor('#000000')).toBe('white');
  });

  it('returns ink on light brand colors', () => {
    expect(readableTextColor('#FFFFFF')).toBe('ink');
    expect(readableTextColor('#FFD400')).toBe('ink'); // bright yellow
  });

  it('returns ink on mid-luminance brand colors (WCAG AA needs dark text)', () => {
    expect(readableTextColor('#00A8E1')).toBe('ink'); // Amazon Prime cyan
    expect(readableTextColor('#FF6B00')).toBe('ink'); // Viaplay orange
    expect(readableTextColor('#FF0000')).toBe('ink'); // YouTube red
  });

  it('handles 3-digit hex and missing #', () => {
    expect(readableTextColor('fff')).toBe('ink');
    expect(readableTextColor('000')).toBe('white');
  });
});
