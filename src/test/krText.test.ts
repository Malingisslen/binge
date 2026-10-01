import { describe, it, expect } from 'vitest';
import { krText } from './krText';

describe('krText (BIN-1386)', () => {
  const m = krText('1 099 kr');

  it.each([
    ['U+0020', '1 099 kr'],
    ['U+00A0', '1 099 kr'],
    ['U+202F', '1 099 kr'],
  ])('godtar %s som tusentalsavgränsare', (_name, text) => {
    expect(m.test(text)).toBe(true);
  });

  it.each([
    ['ett tecken som inte är mellanslag', '1.099 kr'],
    ['en tabb', '1\t099 kr'],
    ['ingen avgränsare alls', '1099 kr'],
  ])('fäller %s', (_name, text) => {
    expect(m.test(text)).toBe(false);
  });

  it('matchar hela texten, inte en del av den', () => {
    expect(m.test('från 1 099 kr')).toBe(false);
  });
});
