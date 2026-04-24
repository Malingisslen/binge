/**
 * Exhaustiveness-check för diskriminerade unions. Placera i `default`-
 * branschen av en switch eller efter alla if/else-grenar — om det tillkommer
 * ett nytt fall i unionen kompilerar TypeScript inte, vilket tvingar dig
 * att behandla det nya fallet explicit.
 *
 * Exempel:
 *   type Status = 'a' | 'b' | 'c';
 *   switch (s) {
 *     case 'a': return ...;
 *     case 'b': return ...;
 *     case 'c': return ...;
 *     default: return assertNever(s);  // Kompilerar bara om alla fall täckta
 *   }
 *
 * **VIKTIGT — använd INTE för unions som persisteras i Firestore** (t.ex.
 * AggregationStrategy, WatchStatus). Legacy- eller hand-editerade docs kan
 * ha värden utanför unionen och kasta istället för att behandlas graciöst.
 * För persisterade unions: behåll `default: <fallback>`-mönstret.
 *
 * Bra användningsområden: in-memory-only unions som PrimaryAction.kind (som
 * beräknas från andra data), rena UI-states, eller i strikt-typade
 * beräkningsflöden där input redan validerats.
 */
export function assertNever(value: never): never {
  throw new Error(
    `assertNever: unhandled union member ${JSON.stringify(value)}`,
  );
}
