import { describe, it, expect } from 'vitest';
import { METRIC_KEYS } from './catalog';
import { EXPLANATIONS } from './explanations';

// The drawer has no fallback text: a metric without an explanation would open an empty panel.
describe('explanations cover the catalog, both ways', () => {
  it('the catalog is not empty (guards the loops below against a silently empty roster)', () => {
    expect(METRIC_KEYS.length).toBeGreaterThan(20);
  });

  it.each(METRIC_KEYS)('%s has an explanation with four non-empty strings', (key) => {
    const ex = EXPLANATIONS[key];
    expect(ex, key).toBeDefined();
    for (const field of ['whatIsIt', 'howCalculated', 'whyImportant', 'source'] as const) {
      expect(typeof ex[field], `${key}.${field}`).toBe('string');
      expect(ex[field].trim().length, `${key}.${field}`).toBeGreaterThan(0);
    }
  });

  it('every explanation key is a catalog key (no explanation for a deleted metric)', () => {
    const catalog = new Set<string>(METRIC_KEYS);
    expect(Object.keys(EXPLANATIONS).filter((k) => !catalog.has(k))).toEqual([]);
  });
});
