import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AvatarInitials, deriveInitials } from './AvatarInitials';

describe('deriveInitials', () => {
  it('takes first letters of the first two words, uppercased', () => {
    expect(deriveInitials('Pedro Pascal')).toBe('PP');
  });
  it('handles a single-word name', () => {
    expect(deriveInitials('Zendaya')).toBe('Z');
  });
  it('uses only the first two words for longer names', () => {
    expect(deriveInitials('Mary Elizabeth Winstead')).toBe('ME');
  });
  it('collapses extra whitespace between words', () => {
    expect(deriveInitials('Bong   Joon  Ho')).toBe('BJ');
  });
  it('trims leading and trailing whitespace', () => {
    expect(deriveInitials('  Greta Gerwig  ')).toBe('GG');
  });
  it('falls back to "?" for empty or whitespace-only names', () => {
    expect(deriveInitials('')).toBe('?');
    expect(deriveInitials('   ')).toBe('?');
  });
});

describe('AvatarInitials', () => {
  it('renders the derived initials with the person name as accessible label', () => {
    render(<AvatarInitials name="Pedro Pascal" size={72} />);
    const el = screen.getByLabelText('Pedro Pascal');
    expect(el).toHaveTextContent('PP');
  });
});
