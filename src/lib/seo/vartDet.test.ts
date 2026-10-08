import { describe, it, expect } from 'vitest';
import {
  LEVEL_RULE_TEXT, VART_DET_MONTHS, VART_DET_ROBOTS, dayText, inMonth, introText, leavingCoversMonth, leavingInMonth,
  newLevel, oldestCheck, parseVartDetMonth, premiereText, priceChangeText,
} from './vartDet';
import type { PriceChange } from '@/lib/tmdb/providers';

const november = parseVartDetMonth('2026-11')!;

describe('parseVartDetMonth', () => {
  it('names the month in Swedish and spans its days', () => {
    expect(november).toEqual({ id: '2026-11', year: 2026, name: 'november', firstDay: '2026-11-01', lastDay: '2026-11-30' });
    expect(parseVartDetMonth('2028-02')?.lastDay).toBe('2028-02-29');
  });
  it('refuses anything that is not a calendar month', () => {
    expect(parseVartDetMonth('2026-13')).toBeNull();
    expect(parseVartDetMonth('2026-00')).toBeNull();
    expect(parseVartDetMonth('november')).toBeNull();
  });
  it('every listed month parses', () => {
    expect(VART_DET_MONTHS.length).toBeGreaterThan(0);
    for (const id of VART_DET_MONTHS) expect(parseVartDetMonth(id)).not.toBeNull();
  });
});

describe('the level rule', () => {
  it('three or more is Mycket nytt, one or two Lite nytt, none Inget nytt', () => {
    expect([0, 1, 2, 3, 9].map(newLevel)).toEqual(['inget', 'lite', 'lite', 'mycket', 'mycket']);
  });
  it('prints the rule as approved', () => {
    expect(LEVEL_RULE_TEXT).toBe('Mycket nytt betyder minst tre nya säsonger eller filmer från tjänsten under månaden enligt TMDB. Lite nytt betyder en eller två. Binge säger inte vilka tjänster du ska ha, bara vad som kommer och vad det kostar.');
  });
});

describe('texts', () => {
  it('the intro names the month and the price check day', () => {
    expect(introText(november, '2026-11-03')).toBe('Vad som kommer, vad som blir dyrare och vad som försvinner på svenska streamingtjänster i november. Priserna kontrollerades den 3 november.');
    expect(dayText('2026-10-07')).toBe('7 oktober');
  });
  it('the oldest check wins, so the intro never claims a fresher check than a row had', () => {
    expect(oldestCheck(['2026-11-03', '2026-10-06'])).toBe('2026-10-06');
  });
  it('claims no check day when a shown service has never been checked', () => {
    expect(oldestCheck(['2026-11-03', undefined])).toBeNull();
    expect(oldestCheck([])).toBeNull();
  });
  it('shows the first premiere with a short date and counts the rest', () => {
    expect(premiereText([{ title: 'Serie säsong 2', date: '2026-11-12', popularity: 90 }, { title: 'Film', date: '2026-11-21', popularity: 40 }]))
      .toEqual({ first: 'Serie säsong 2 (12 nov)', more: 'och 1 till' });
    expect(premiereText([])).toBeNull();
  });
});

describe('priceChangeText', () => {
  const change = (date: string, tierId: string | null, fromKr: number, toKr: number): PriceChange =>
    ({ date, dateKind: 'effective', providerId: 337, tierId, fromKr, toKr, source: 'x' });
  it('shows a change dated in the month for the plan shown', () => {
    expect(priceChangeText(337, 'standard', november, [change('2026-11-05', 'standard', 69, 89)])).toBe('69 → 89 kr');
    expect(priceChangeText(337, 'standard', november, [change('2026-11', null, 69, 89)])).toBe('69 → 89 kr');
  });
  it('a price Binge only noticed in the month is not a change in the month', () => {
    expect(priceChangeText(337, 'standard', november, [{ ...change('2026-11-03', 'standard', 69, 89), dateKind: 'noticed' }])).toBe('Oförändrat');
  });
  it('is Oförändrat for another month, another plan or another service', () => {
    expect(priceChangeText(337, 'standard', november, [change('2026-10-30', 'standard', 69, 89)])).toBe('Oförändrat');
    expect(priceChangeText(337, 'standard', november, [change('2026-11-05', 'premium', 99, 119)])).toBe('Oförändrat');
    expect(priceChangeText(8, 'standard', november, [change('2026-11-05', 'standard', 69, 89)])).toBe('Oförändrat');
  });
});

describe('leavingCoversMonth', () => {
  it('counts only when the rollup reaches the month end and the month is not over', () => {
    expect(leavingCoversMonth('2026-11-03', november)).toBe(true);
    expect(leavingCoversMonth('2026-10-30', november)).toBe(true);
    expect(leavingCoversMonth('2026-10-07', november)).toBe(false);
    expect(leavingCoversMonth('2026-12-01', november)).toBe(false);
    expect(leavingCoversMonth(null, november)).toBe(false);
  });
});

describe('leavingInMonth', () => {
  it('counts only titles leaving inside the month', () => {
    expect(leavingInMonth([{ leaving: '2026-10-31' }, { leaving: '2026-11-01' }, { leaving: '2026-11-30' }, { leaving: '2026-12-01' }], november)).toBe(2);
    expect(inMonth(null, november)).toBe(false);
  });
});

describe('hidden until published', () => {
  it('is noindex but follow, like /streamingpriser/', () => {
    expect(VART_DET_ROBOTS).toEqual({ index: false, follow: true });
  });
});
