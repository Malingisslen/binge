import { describe, it, expect } from 'vitest';
import { fitRows } from './monthlyBillImage';

const row = (i: number) => ({ name: `Tjänst ${i}`, text: `${i} kr per avsnitt` });

describe('fitRows', () => {
  it('keeps a bill that fits as it is', () => {
    const rows = [1, 2, 3].map(row);
    expect(fitRows(rows)).toEqual(rows);
  });

  it('folds the rows that would run into the total into one "och N till" row', () => {
    const rows = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(row);
    const fitted = fitRows(rows);
    expect(fitted).toHaveLength(7);
    expect(fitted.slice(0, 6)).toEqual(rows.slice(0, 6));
    expect(fitted[6]).toEqual({ name: 'och 3 till', text: '' });
  });
});
