import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

// Static export prerenderar även klientkomponenter i Node, där useLayoutEffect
// inte kan köra (React varnar). Server-passet har ändå inga användarhändelser
// att kapplöpa mot, så en passiv effekt duger där.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Optimistisk spegel av ett numeriskt-nycklat profil-map (providerCosts,
 * providerCampaigns, providerRenewalDays) med rollback när writen misslyckas.
 *
 * Två buggklasser motiverar mönstret, och båda löses här EN gång istället för
 * tre kopior i AuthContext:
 *
 * 1. **Stale render-snapshot (BIN-40 / BIN-46).** Spegeln uppdateras SYNKRONT
 *    före `await`, så att tabba från provider A:s fält till B:s inte skriver två
 *    blur:ar mot samma gamla render-snapshot och tappar A:s värde.
 * 2. **Smygpersistad avvisad edit (BIN-516 / BIN-531).** Nådde writen aldrig
 *    Firestore rullas spegeln tillbaka, annars skulle det avvisade värdet åka
 *    med i nästa edits spread. Rollbacken är identity-checkad så den inte
 *    klobbrar en senare concurrent edit — eller profil-sync-effekten — som redan
 *    hunnit byta ref:en.
 *
 * `commit` läses via en ref, så den returnerade setter:n är stabil även om
 * anroparen skickar in en ny closure varje render.
 *
 * 3. **Kontobyte mitt i en edit (2026-07-20).** Båda ref:arna sätts i en LAYOUT-
 *    effekt, inte en passiv. En passiv effekt flushas efter paint, så en blur i
 *    det glappet körde föregående renders `commit` (bunden till föregående uid)
 *    och jämförde mot föregående användares snapshot — på en delad dator kunde
 *    en användares prisuppgifter följa med in i nästa användares profil.
 *    Layout-effekten körs synkront i commit-fasen, innan webbläsaren kan
 *    behandla någon inmatning, så glappet finns inte. (Att sätta ref:arna under
 *    render vore ännu tidigare men bryter mot React-reglerna för concurrent
 *    rendering — linten stoppar det, med rätta.)
 */
export function useOptimisticMirrorField<V>(
  /** The account this mirror belongs to (uid). `null`/`undefined` = signed out. */
  ownerKey: string | null | undefined,
  source: Record<number, V> | undefined,
  commit: (next: Record<number, V>) => Promise<void>,
): (key: number, value: V | null) => Promise<void> {
  const mirrorRef = useRef<Record<number, V>>({});
  const commitRef = useRef(commit);

  // BIN-592: `ownerKey` (the uid) is in the dep list because `source` ALONE cannot
  // detect an account switch. A user who has never saved a price has
  // `source === undefined`, and so does the next user — sign-out and sign-in both
  // leave the dep unchanged, so this effect never re-ran and the previous account's
  // map stayed in the ref. The next user's first edit then spread it into THEIR
  // profile write, handing them a subscription cost they never entered (and
  // Streamingrådgivaren then billed them for it). Keying on the account states the
  // invariant directly instead of hoping the value happens to differ.
  useIsomorphicLayoutEffect(() => { mirrorRef.current = source ?? {}; }, [ownerKey, source]);
  useIsomorphicLayoutEffect(() => { commitRef.current = commit; }, [commit]);

  return useCallback(async (key: number, value: V | null) => {
    const prev = mirrorRef.current;
    const next = { ...prev };
    if (value == null) delete next[key];
    else next[key] = value;
    mirrorRef.current = next;
    try {
      await commitRef.current(next);
    } catch (err) {
      if (mirrorRef.current === next) mirrorRef.current = prev;
      throw err;
    }
  }, []);
}
