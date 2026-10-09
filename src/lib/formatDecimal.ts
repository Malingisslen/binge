// Decimaltal med svenskt decimalkomma ("3,8", "8,3") — betyg, snitt och liknande.
// Presentation only. Heltal skrivs med en decimal ("5,0") så en kolumn håller bredden.
export function formatDecimal(n: number, digits = 1): string {
  return n.toFixed(digits).replace('.', ',');
}
