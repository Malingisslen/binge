import { describe, it, expect } from 'vitest';
import { shortSwedishDate, tvDeviceSubtitle } from './tvDeviceDates';

const NOW = new Date(2026, 9, 31, 14, 0);

describe('shortSwedishDate', () => {
  it.each(['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'])('names month %s', (name) => {
    const idx = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'].indexOf(name);
    expect(shortSwedishDate(new Date(2026, idx, 12))).toBe(`12 ${name} 2026`);
  });
  it('writes day, short month and year', () => {
    expect(shortSwedishDate(new Date(2026, 9, 31))).toBe('31 okt 2026');
    expect(shortSwedishDate(new Date(2026, 4, 1))).toBe('1 maj 2026');
  });
});

describe('tvDeviceSubtitle', () => {
  it('says idag when last seen the same day', () => {
    expect(tvDeviceSubtitle(new Date(2026, 9, 1), new Date(2026, 9, 31, 8), NOW))
      .toBe('Kopplad 1 okt 2026 · senast använd idag');
  });
  it('gives a date when last seen earlier', () => {
    expect(tvDeviceSubtitle(new Date(2026, 9, 1), new Date(2026, 9, 30, 23, 59), NOW))
      .toBe('Kopplad 1 okt 2026 · senast använd 30 okt 2026');
  });
  it('does not say idag for the same day number in another month or year', () => {
    expect(tvDeviceSubtitle(null, new Date(2026, 8, 30 + 1), NOW)).toBe('senast använd 1 okt 2026');
    expect(tvDeviceSubtitle(null, new Date(2026, 8, 30), new Date(2026, 9, 30)))
      .toBe('senast använd 30 sep 2026');
    expect(tvDeviceSubtitle(null, new Date(2025, 9, 31), NOW)).toBe('senast använd 31 okt 2025');
  });
  it('shows last use when the connection date is missing', () => {
    expect(tvDeviceSubtitle(null, new Date(2026, 9, 31, 8), NOW)).toBe('senast använd idag');
  });
  it('leaves out what is unknown', () => {
    expect(tvDeviceSubtitle(new Date(2026, 9, 1), null, NOW)).toBe('Kopplad 1 okt 2026');
    expect(tvDeviceSubtitle(null, null, NOW)).toBe('');
  });
});
