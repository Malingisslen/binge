import type { CalendarCounts } from './summary';

// Kalendersidans rubrik + undertext (K2). Kontrakt: aritmetiken är ÄRLIG —
//
//  * Rubriken räknar bara DISJUNKTA kategorier: avsnitt och filmer. Premiärer
//    är en delmängd av avsnitten och får aldrig adderas som egen term
//    ("2 avsnitt och 1 premiär" lästes som 3 händelser — det var 2).
//  * Undertexten lyfter delmängderna med "varav", och ett avsnitt som är både
//    premiär och final räknas i exakt EN kategori (premiär vinner — det är
//    den större nyheten). Därmed kan premiärer + finaler aldrig överstiga
//    avsnittstotalen i rubriken.
//
// Ren modul utan React/Firebase så kontraktet är testbart (copy.test.ts).

/** Veckans h1. Tom vecka → lugn ton. */
export function buildCalendarHeadline(counts: CalendarCounts): string {
  const { episodes, movies } = counts;
  if (episodes === 0 && movies === 0) return 'En lugn vecka.';
  const parts: string[] = [];
  if (episodes > 0) parts.push(`${episodes} avsnitt`);
  if (movies > 0) parts.push(`${movies} ${movies === 1 ? 'film' : 'filmer'}`);
  return `Denna vecka — ${parts.join(' och ')}.`;
}

/** Undertext under h1. Premiärer/finaler som "varav"-delmängd av avsnitten. */
export function buildCalendarStandfirst(counts: CalendarCounts, isCurrent: boolean): string {
  const { episodes, movies, premieres, finales, premiereFinales, total } = counts;
  if (total === 0) {
    return isCurrent
      ? 'Inget på schemat denna vecka. Utforska Rekommendationer för att hitta något.'
      : 'Inget på schemat den här veckan.';
  }
  // Disjunkt: premiär+final-avsnitt räknas som premiär, inte som final.
  const finalesShown = finales - premiereFinales;
  const parts: string[] = [];
  if (premieres > 0) parts.push(`${premieres} premiär${premieres === 1 ? '' : 'er'}`);
  if (finalesShown > 0) parts.push(`${finalesShown} säsongsfinal${finalesShown === 1 ? '' : 'er'}`);
  if (parts.length > 0) {
    return `Varav ${joinSwedish(parts)}. Markera avsnitten du har sett när du är klar.`;
  }
  if (episodes === 0 && movies > 0) {
    // Bara filmsläpp — uppmaningen om avsnitt vore missvisande.
    return 'Veckans filmsläpp nedan.';
  }
  return isCurrent
    ? 'Allt på schemat ligger nedanför. Markera avsnitten du har sett när du är klar.'
    : 'Veckans avsnitt nedan.';
}

// "a", "a och b", "a, b och c" — svensk uppräkning.
function joinSwedish(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} och ${parts[parts.length - 1]}`;
}
