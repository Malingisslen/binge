import { describe, it, expect } from 'vitest';
import { buildCalendarHeadline, buildCalendarStandfirst } from './copy';
import type { CalendarCounts } from './summary';

function counts(p: Partial<CalendarCounts> = {}): CalendarCounts {
  return {
    episodes: 0,
    movies: 0,
    premieres: 0,
    finales: 0,
    premiereFinales: 0,
    total: 0,
    ...p,
  };
}

// K2-kontraktet: rubrik + undertext får aldrig dubbelräkna. Premiärer/finaler
// är delmängder av avsnitten — rubriken räknar bara disjunkta kategorier
// (avsnitt, filmer) och undertexten uttrycker delmängderna med "varav" så att
// delarna aldrig överstiger totalen.

describe('buildCalendarHeadline', () => {
  it('lugn vecka när inget händer', () => {
    expect(buildCalendarHeadline(counts())).toBe('En lugn vecka.');
  });

  it('räknar bara avsnitt och filmer — premiärer är ingen egen term', () => {
    // Före fixen: "Denna vecka — 2 avsnitt och 1 premiär" lästes som 3 händelser.
    expect(buildCalendarHeadline(counts({ episodes: 2, premieres: 1, total: 2 })))
      .toBe('Denna vecka — 2 avsnitt.');
  });

  it('avsnitt och filmer tillsammans', () => {
    expect(buildCalendarHeadline(counts({ episodes: 3, movies: 2, total: 5 })))
      .toBe('Denna vecka — 3 avsnitt och 2 filmer.');
  });

  it('singular film', () => {
    expect(buildCalendarHeadline(counts({ movies: 1, total: 1 })))
      .toBe('Denna vecka — 1 film.');
  });
});

describe('buildCalendarStandfirst', () => {
  it('tom vecka — innevarande respektive annan vecka', () => {
    expect(buildCalendarStandfirst(counts(), true))
      .toBe('Inget på schemat denna vecka. Utforska Rekommendationer för att hitta något.');
    expect(buildCalendarStandfirst(counts(), false))
      .toBe('Inget på schemat den här veckan.');
  });

  it('uttrycker premiärer och finaler som delmängd med "varav"', () => {
    expect(buildCalendarStandfirst(
      counts({ episodes: 5, premieres: 1, finales: 2, total: 5 }), true,
    )).toBe('Varav 1 premiär och 2 säsongsfinaler. Markera avsnitten du har sett när du är klar.');
  });

  it('ett avsnitt som är både premiär och final räknas en gång (som premiär)', () => {
    // Före fixen: "1 premiär och 1 säsongsfinal" för ett enda avsnitt.
    expect(buildCalendarStandfirst(
      counts({ episodes: 1, premieres: 1, finales: 1, premiereFinales: 1, total: 1 }), true,
    )).toBe('Varav 1 premiär. Markera avsnitten du har sett när du är klar.');
  });

  it('delarna överstiger aldrig avsnittstotalen', () => {
    // 2 avsnitt: ett är premiär+final, ett är bara final → "1 premiär och
    // 1 säsongsfinal" = 2 delar av 2 avsnitt. Aldrig 1+2=3.
    expect(buildCalendarStandfirst(
      counts({ episodes: 2, premieres: 1, finales: 2, premiereFinales: 1, total: 2 }), true,
    )).toBe('Varav 1 premiär och 1 säsongsfinal. Markera avsnitten du har sett när du är klar.');
  });

  it('inga höjdpunkter — bara avsnitt', () => {
    expect(buildCalendarStandfirst(counts({ episodes: 3, total: 3 }), true))
      .toBe('Allt på schemat ligger nedanför. Markera avsnitten du har sett när du är klar.');
    expect(buildCalendarStandfirst(counts({ episodes: 3, total: 3 }), false))
      .toBe('Veckans avsnitt nedan.');
  });

  it('bara filmsläpp — ingen avsnittsuppmaning', () => {
    expect(buildCalendarStandfirst(counts({ movies: 2, total: 2 }), true))
      .toBe('Veckans filmsläpp nedan.');
  });
});
