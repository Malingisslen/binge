// Kronbelopp med svensk tusentalsgruppering ("1 234"). Varje kronbelopp på sparsidan
// går hit, så att paketkortet och resten av sidan skriver samma tal på samma sätt
// (BIN-1339, BIN-1348). Presentation only — callers pass the number they already have.
export function formatKr(kr: number): string {
  return kr.toLocaleString('sv-SE');
}
