// BIN-46 — prenumerations-förnyelse från en faktureringsdag.
//
// Användaren anger en dag-i-månaden (1–28) per tjänst i inställningarna. Vi
// cappar till 28 så vi slipper månadslängd-kantfall (februari, 30/31) — en
// faktureringsdag den 29–31 finns inte alla månader. Nästa förnyelse är nästa
// förekomst av dagen från och med idag (idag = "om 0 dagar" om det är dagen).
// Rena funktioner (injicerat `from`) så de enhetstestas utan klocka.

export const MAX_BILLING_DAY = 28;

export function isValidBillingDay(day: number): boolean {
  return Number.isInteger(day) && day >= 1 && day <= MAX_BILLING_DAY;
}

/** Nästa förnyelsedatum (lokal midnatt) för en faktureringsdag. */
export function nextRenewalDate(billingDay: number, from: Date): Date {
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const thisMonth = new Date(from.getFullYear(), from.getMonth(), billingDay);
  // Redan passerat denna månad → hoppa till nästa månad (Date normaliserar
  // månads-overflow, men billingDay ≤ 28 gör det ändå alltid giltigt).
  return thisMonth < today
    ? new Date(from.getFullYear(), from.getMonth() + 1, billingDay)
    : thisMonth;
}

/** Antal hela dagar till nästa förnyelse (0 = idag). */
export function daysUntilRenewal(billingDay: number, from: Date): number {
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const next = nextRenewalDate(billingDay, from);
  // Math.round absorberar ev. DST-timskift inom dygnsdiffen.
  return Math.round((next.getTime() - today.getTime()) / 86_400_000);
}
