import { describe, it, expect } from 'vitest';
import {
  activeBinding,
  bindingEndMonth,
  bindingFreeFromDate,
  bindingState,
  boundDaysBetween,
  formatMonthYear,
  monthAfter,
  parseBinding,
  pausedSavingsKr,
  readProviderBindings,
  sanitizeBindingInput,
  type ProviderBinding,
} from './bindings';

const b = (over: Partial<ProviderBinding> = {}): ProviderBinding => ({ months: 12, startedOn: '2026-11', monthlyCost: 149, ...over });
const day = (y: number, m: number, d = 15) => new Date(y, m - 1, d);

describe('bindingEndMonth', () => {
  it('is the start month plus the length', () => {
    expect(bindingEndMonth(b())).toBe('2027-11');
    expect(bindingEndMonth(b({ months: 6 }))).toBe('2027-05');
    expect(bindingEndMonth(b({ months: 3, startedOn: '2026-12' }))).toBe('2027-03');
  });
  it('rolls over the year boundary for 24 months', () => {
    expect(bindingEndMonth(b({ months: 24, startedOn: '2026-01' }))).toBe('2028-01');
  });
  it('12 months from january ends the january after, not december', () => {
    expect(bindingEndMonth(b({ startedOn: '2026-01' }))).toBe('2027-01');
  });
});

describe('bindingState (month boundaries)', () => {
  const map = { 76: b() }; // ends 2027-11
  it('is active the month before the end month', () => {
    expect(bindingState(map, 76, day(2027, 10, 31)).kind).toBe('active');
  });
  it('is active during the whole end month, including its last day', () => {
    expect(bindingState(map, 76, day(2027, 11, 1)).kind).toBe('active');
    expect(bindingState(map, 76, new Date(2027, 10, 30, 23, 59)).kind).toBe('active');
  });
  it('is expired from the first day of the month after', () => {
    expect(bindingState(map, 76, day(2027, 12, 1)).kind).toBe('expired');
  });
  it('a 6-month and a 12-month binding from the same month end at different times', () => {
    const six = { 76: b({ months: 6 }) }; // ends 2027-05
    const now = day(2027, 6, 10);
    expect(bindingState(six, 76, now).kind).toBe('expired');
    expect(bindingState(map, 76, now).kind).toBe('active');
  });
  it('is none before the start month, so an earlier bill is never priced with it', () => {
    expect(bindingState(map, 76, day(2026, 10, 31)).kind).toBe('none');
    expect(bindingState(map, 76, day(2026, 11, 1)).kind).toBe('active');
  });
  it('is none when there is no entry or no map', () => {
    expect(bindingState(map, 8, day(2026, 12)).kind).toBe('none');
    expect(bindingState(undefined, 8, day(2026, 12)).kind).toBe('none');
  });
  it('resolves an alias id to the canonical entry (531 -> 431)', () => {
    expect(activeBinding({ 431: b() }, 531, day(2026, 12))).not.toBeNull();
  });
});

describe('defensive reading', () => {
  it.each([
    ['null', null],
    ['a string', 'bunden'],
    ['an array', [1, 2]],
    ['months outside the list', { months: 5, startedOn: '2026-11', monthlyCost: 100 }],
    ['months as a string', { months: '12', startedOn: '2026-11', monthlyCost: 100 }],
    ['month 13', { months: 12, startedOn: '2026-13', monthlyCost: 100 }],
    ['month 00', { months: 12, startedOn: '2026-00', monthlyCost: 100 }],
    ['a full date', { months: 12, startedOn: '2026-11-01', monthlyCost: 100 }],
    ['a negative price', { months: 12, startedOn: '2026-11', monthlyCost: -1 }],
    ['an infinite price', { months: 12, startedOn: '2026-11', monthlyCost: Infinity }],
    ['NaN', { months: 12, startedOn: '2026-11', monthlyCost: NaN }],
    ['a price above the cap', { months: 12, startedOn: '2026-11', monthlyCost: 10_001 }],
    ['a missing price', { months: 12, startedOn: '2026-11' }],
  ])('treats %s as no binding and never throws', (_name, raw) => {
    expect(parseBinding(raw)).toBeNull();
    expect(bindingState({ 76: raw }, 76, day(2026, 12)).kind).toBe('none');
  });

  it('readProviderBindings keeps only whole, valid entries and canonical keys', () => {
    const out = readProviderBindings({
      76: b(),
      531: b({ months: 6 }),
      abc: b(),
      '-3': b(),
      8: { months: 99 },
    });
    expect(Object.keys(out).sort()).toEqual(['431', '76']);
    expect(readProviderBindings('x')).toEqual({});
    expect(readProviderBindings(null)).toEqual({});
    expect(readProviderBindings([b()])).toEqual({});
  });
});

describe('sanitizeBindingInput', () => {
  it('rounds the price to whole kronor', () => {
    expect(sanitizeBindingInput({ months: 12, startedOn: '2026-11', monthlyCost: 149.6 })?.monthlyCost).toBe(150);
  });
  it('rejects a length outside 3/6/12/24, a bad month and an out-of-range price', () => {
    expect(sanitizeBindingInput({ months: 9, startedOn: '2026-11', monthlyCost: 100 })).toBeNull();
    expect(sanitizeBindingInput({ months: 12, startedOn: '2026-1', monthlyCost: 100 })).toBeNull();
    expect(sanitizeBindingInput({ months: 12, startedOn: '2026-11', monthlyCost: 10_001 })).toBeNull();
    expect(sanitizeBindingInput({ months: 12, startedOn: '2026-11', monthlyCost: -5 })).toBeNull();
  });
});

describe('formatting and dates', () => {
  it('formats a month in Swedish', () => {
    expect(formatMonthYear('2027-11')).toBe('nov 2027');
    expect(formatMonthYear('2027-03')).toBe('mars 2027');
  });
  it('monthAfter crosses the year', () => {
    expect(monthAfter('2027-12')).toBe('2028-01');
  });
  it('first free day is the 1st of the month after the end month', () => {
    expect(bindingFreeFromDate(b())).toBe('2027-12-01');
  });
});

describe('boundDaysBetween', () => {
  const binding = b({ months: 3, startedOn: '2026-11' }); // bound through 2027-02, free from 2027-03-01
  it('counts only days before the free date', () => {
    expect(boundDaysBetween(binding, new Date(2027, 1, 20), new Date(2027, 2, 5))).toBe(9); // 20 feb -> 1 mars
  });
  it('is zero for a window entirely after the binding', () => {
    expect(boundDaysBetween(binding, new Date(2027, 2, 1), new Date(2027, 2, 20))).toBe(0);
  });
  it('is the full window when entirely inside the binding', () => {
    expect(boundDaysBetween(binding, new Date(2026, 11, 1), new Date(2026, 11, 11))).toBe(10);
  });
  it('is zero for an empty or reversed window', () => {
    expect(boundDaysBetween(binding, new Date(2026, 11, 11), new Date(2026, 11, 1))).toBe(0);
  });
});

describe('pausedSavingsKr', () => {
  const bindings = { 76: b({ months: 3, startedOn: '2026-11', monthlyCost: 150 }) }; // fri från 2027-03-01
  it('utan bindning är det hela perioden', () => {
    expect(pausedSavingsKr(150, 30, '2026-10-01', undefined, 76, new Date(2026, 10, 1))).toBe(150);
  });
  it('en bindning som tar slut mitt i pausen räknar bara dagarna efter slutet', () => {
    // Pausad 2027-02-20, idag 2027-03-22: 30 dagar totalt, 9 inom bindningen (20 feb till 1 mars) -> 21 dagar sparade.
    expect(pausedSavingsKr(150, 30, '2027-02-20', bindings, 76, new Date(2027, 2, 22))).toBe(105);
  });
  it('en paus helt inom bindningen sparar noll', () => {
    expect(pausedSavingsKr(150, 20, '2026-12-01', bindings, 76, new Date(2026, 11, 21))).toBe(0);
  });
  it('en paus helt efter bindningen räknas i sin helhet', () => {
    expect(pausedSavingsKr(150, 30, '2027-04-01', bindings, 76, new Date(2027, 4, 1))).toBe(150);
  });
});

describe('gränser för inmatning', () => {
  it('0 kr och exakt taket är giltiga, strax över är det inte', () => {
    expect(parseBinding(b({ monthlyCost: 0 }))).not.toBeNull();
    expect(parseBinding(b({ monthlyCost: 10_000 }))).not.toBeNull();
    expect(parseBinding(b({ monthlyCost: 10_000.5 }))).toBeNull();
    expect(parseBinding(b({ monthlyCost: -0.5 }))).toBeNull();
  });
  it('readProviderBindings släpper nyckel 0 men behåller 1', () => {
    expect(Object.keys(readProviderBindings({ 0: b(), 1: b() }))).toEqual(['1']);
  });
});
