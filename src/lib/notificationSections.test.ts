import { describe, it, expect } from 'vitest';
import { notificationSections } from './notificationSections';

// BIN-1265: a report's outcome and a group's new owner stood under "Streamingnyheter".
describe('notificationSections', () => {
  const card = (id: string, kind: string) => ({ id, kind });

  it('puts system cards under "Från Binge", first, and the rest under "Streamingnyheter"', () => {
    const sections = notificationSections([
      card('a', 'availability'), card('b', 'system'), card('c', 'episode_release'), card('d', 'system'),
    ]);
    expect(sections.map((s) => s.heading)).toEqual(['Från Binge', 'Streamingnyheter']);
    expect(sections[0].items.map((n) => n.id)).toEqual(['b', 'd']);
    expect(sections[1].items.map((n) => n.id)).toEqual(['a', 'c']);
  });

  it('leaves out an empty section', () => {
    expect(notificationSections([card('a', 'availability')]).map((s) => s.heading)).toEqual(['Streamingnyheter']);
    expect(notificationSections([card('b', 'system')]).map((s) => s.heading)).toEqual(['Från Binge']);
    expect(notificationSections([])).toEqual([]);
  });

  it('counts the ten newest cards before splitting, as the bell did', () => {
    const many = Array.from({ length: 12 }, (_, i) => card(`n${i}`, i === 11 ? 'system' : 'availability'));
    const sections = notificationSections(many);
    expect(sections.map((s) => s.heading)).toEqual(['Streamingnyheter']);
    expect(sections[0].items).toHaveLength(10);
  });
});
