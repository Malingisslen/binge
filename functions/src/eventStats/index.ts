/**
 * Anropbar räknare för hur funktioner används (BIN-1438) — ersätter Plausible.
 *
 * Skriver eventStats/{YYYY-MM-DD} (Stockholmsdag); samlingen är låst för klienter i
 * firestore.rules, så räknarna kan inte förfalskas genom att skriva Firestore direkt.
 * Allt som skickas prövas mot ordförrådet i logic.ts innan det blir en fältsökväg.
 *
 * Grind: App Check krävs för varje anrop (enforceAppCheck), och det finns ingen gren för
 * inloggade. Funktionen läser bara anropets data — aldrig anroparens konto, adress
 * eller webbläsare — och loggar ingenting själv. maxInstances begränsar kostnaden vid
 * missbruk.
 *
 * Dagsumman är det enda som sparas. Klienten samlar händelser och skickar högst var 30:e
 * sekund (src/lib/analytics.ts).
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { buildIncrementPayload, planIncrements, stockholmDayId } from './logic';

export const recordEvent = onCall(
  { region: 'europe-west1', enforceAppCheck: true, maxInstances: 5 },
  async (request) => {
    const increments = planIncrements(request.data);
    if (increments.length === 0) return { ok: true };

    // En enda merge med FieldValue.increment: fält och maps skapas vid behov, och
    // dokumentet bär bara ordförrådets fasta nycklar.
    const payload = buildIncrementPayload(increments, (delta) => FieldValue.increment(delta));

    await getFirestore().collection('eventStats').doc(stockholmDayId()).set(payload, { merge: true });
    return { ok: true };
  },
);
