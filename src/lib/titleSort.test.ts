import { describe, it, expect } from 'vitest';
import { compareTitles } from './titleSort';

describe('compareTitles', () => {
  it('sorterar en titel med citattecken efter sin första bokstav', () => {
    const titles = ['"Wuthering Heights"', 'Alien', 'Zodiac', 'Örnen'];
    expect([...titles].sort(compareTitles)).toEqual(['Alien', '"Wuthering Heights"', 'Zodiac', 'Örnen']);
  });

  it('följer svensk ordning för å, ä och ö', () => {
    expect(['Ö', 'Ä', 'Å', 'Z'].sort(compareTitles)).toEqual(['Z', 'Å', 'Ä', 'Ö']);
  });

  it('behåller en titel som bara består av tecken', () => {
    expect(compareTitles('...', '...')).toBe(0);
    expect(['B', '!!!', 'A'].sort(compareTitles)).toEqual(['!!!', 'A', 'B']);
  });
});
