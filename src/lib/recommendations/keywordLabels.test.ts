import { describe, it, expect } from 'vitest';
import { swedishKeywordLabel } from './keywordLabels';

describe('swedishKeywordLabel', () => {
  it('översätter ett känt nyckelord oavsett skiftläge', () => {
    expect(swedishKeywordLabel('based on novel or book')).toBe('bygger på en roman');
    expect(swedishKeywordLabel('Based on Novel or Book')).toBe('bygger på en roman');
  });

  it('ger null för ett nyckelord utan översättning', () => {
    expect(swedishKeywordLabel('woman director')).toBeNull();
  });

  it('tål blanksteg runt namnet', () => {
    expect(swedishKeywordLabel('  Time Travel ')).toBe('tidsresor');
  });

  it('svarar inte med något som bara finns på objektprototypen', () => {
    expect(swedishKeywordLabel('constructor')).toBeNull();
    expect(swedishKeywordLabel('toString')).toBeNull();
  });
});
