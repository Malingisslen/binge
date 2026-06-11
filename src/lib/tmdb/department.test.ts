import { describe, it, expect } from 'vitest';
import { translateDepartment } from './department';

describe('translateDepartment', () => {
  it('translates known TMDB departments to Swedish', () => {
    expect(translateDepartment('Acting')).toBe('Skådespelare');
    expect(translateDepartment('Directing')).toBe('Regi');
    expect(translateDepartment('Writing')).toBe('Manus');
    expect(translateDepartment('Production')).toBe('Produktion');
    expect(translateDepartment('Costume & Make-Up')).toBe('Kostym & smink');
    expect(translateDepartment('Visual Effects')).toBe('Visuella effekter');
  });

  it('is case-insensitive on input', () => {
    expect(translateDepartment('ACTING')).toBe('Skådespelare');
    expect(translateDepartment('acting')).toBe('Skådespelare');
  });

  it('falls back to capitalize-first for unknown departments', () => {
    expect(translateDepartment('Stunts')).toBe('Stunts');
    expect(translateDepartment('STUNTS')).toBe('Stunts');
  });

  it('returns "Person" for null/undefined/empty', () => {
    expect(translateDepartment(null)).toBe('Person');
    expect(translateDepartment(undefined)).toBe('Person');
    expect(translateDepartment('')).toBe('Person');
  });
});
