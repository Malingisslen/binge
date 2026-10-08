// Kronbelopp med svensk tusentalsgruppering ("1 234") (BIN-1339, BIN-1348, BIN-1365).
// Presentation only — callers pass the number they already have.
export function formatKr(kr: number): string {
  return kr.toLocaleString('sv-SE');
}
