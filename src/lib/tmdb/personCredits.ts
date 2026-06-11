// PE3: talkshow-/galagästspel (character "Self", "Herself", "Self - Guest" …)
// dränker riktiga roller i filmografin. Separera dem så riktiga roller visas
// först och gästframträdanden samlas i en egen sektion.

const SELF_RE = /(?:^|[\s(\-–—/,])(self|himself|herself|themselves|sig själv)(?:$|[\s)\-–—/,.])/i;

/** Sant när cast-rollen är ett "Self"-gästframträdande (ej en spelad roll). */
export function isSelfCredit(role: string | null | undefined): boolean {
  if (!role) return false;
  return SELF_RE.test(role);
}

/** Dela upp credits i riktiga roller och Self-gästframträdanden. */
export function splitSelfCredits<T extends { role?: string | null }>(
  credits: readonly T[],
): { roles: T[]; selfCredits: T[] } {
  const roles: T[] = [];
  const selfCredits: T[] = [];
  for (const c of credits) {
    (isSelfCredit(c.role) ? selfCredits : roles).push(c);
  }
  return { roles, selfCredits };
}
