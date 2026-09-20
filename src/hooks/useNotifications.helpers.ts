// BIN-1170: skrivvägarna för notisernas läs-status, brutna ur hooken så de går
// att pröva utan en Firebase-import i testmiljön (samma mönster som
// `useMarkSeen.helpers.ts`). `errorCodes.ts` är avsiktligt Firebase-import-fri —
// dess egen huvudkommentar säger varför — så predikatet nedan bryter inte det.
//
// Tre egenskaper hänger på den här filen, och var och en har ett eget test:
//
// 1. Ett avvisande som bara betyder "notisen är redan borta" larmar inte
//    ANVÄNDAREN: raden är då ute ur den lyssnande listan och hen ser rätt sak.
//    Knapparna i `TopbarActions` är fire-and-forget, så ett avvisat löfte syns
//    inte någonstans i UI:t.
//
//    VILKEN KOD DET ÄR, MÄTT (BIN-1251, 2026-09-20). Regelns update-gren för
//    notiser avrefererar `resource.data` genom `diff(...)`. Finns dokumentet inte
//    faller regelutvärderingen på ett nollvärde i stället för att svara falskt,
//    och servern ger `permission-denied`. Emulatorn skriver ut just det:
//      evaluation error ... Null value error. for 'update'
//    Testet som mäter det heter "an updateDoc against a DELETED notification
//    reports permission-denied, not not-found" i `src/test/rules/firestore-rules.test.ts`.
//    Härled grenen med:  grep -n "affectedKeys" firestore.rules
//
//    Predikatet delas med `errorCodes.ts` övriga anropare just för att de två
//    inte ska glida isär.
//
// 2. Men det RAPPORTERAS, under ett eget `kind`. Det är skillnaden mellan tyst
//    mot användaren och tyst mot oss, och `guardedItemWrite` i
//    `WatchlistContext` sväljer exakt samma kod och rapporterar ändå — samma val
//    som BIN-957 gjorde för fyra andra vägar. Skälet: `permission-denied` på den
//    här skrivningen betyder inte BARA raderingskapplöpningen. En regelregression,
//    en utloggad session eller ett nekat App Check ger samma kod, och utan
//    rapporten skulle varje "markera som läst" i appen kunna falla medan klockan
//    behåller sitt antal och ingenting någonstans säger det. En enstaka träff är
//    väntad och godartad; återkommande träffar är signalen. `BENIGN_KIND_*`
//    nedan är därför egna `kind`-värden, inte samma som felvägens — de ska gå
//    att skilja åt i Sentry. Öppen fråga, filad som BIN-1254: om
//    raderingskapplöpningen och den utloggade sessionen ska skiljas åt här.
//
// 3. "Markera alla som lästa" skrev tidigare en atomisk `writeBatch`. En
//    uppdatering av ett dokument som hunnit raderas faller på regelutvärderingen,
//    och eftersom bunten är atomisk markerades då ingen av de övriga heller —
//    klockan stod kvar på sitt fulla antal. Skrivningarna går därför en och en.

import { isPermissionDenied } from '@/lib/firebase/errorCodes';

export type NotificationWrite = (notifId: string) => Promise<unknown>;
export type WriteFailureReporter = (error: unknown, kind: string) => void;

/** Det väntade, godartade avvisandet — rapporterat, men aldrig visat för användaren. */
const BENIGN_KIND_ONE = 'markRead-refused';
const BENIGN_KIND_MANY = 'markAllRead-refused';

/** Markera en notis som läst. Ett avvisat löfte rapporteras, inget kastas vidare. */
export async function markOneRead(
  write: NotificationWrite,
  notifId: string,
  report: WriteFailureReporter,
): Promise<void> {
  try {
    await write(notifId);
  } catch (error) {
    report(error, isPermissionDenied(error) ? BENIGN_KIND_ONE : 'markRead');
  }
}

/**
 * Markera flera notiser som lästa, var och en för sig: den som misslyckas tar
 * bara sin egen rad med sig.
 */
export async function markManyRead(
  write: NotificationWrite,
  notifIds: readonly string[],
  report: WriteFailureReporter,
): Promise<void> {
  const results = await Promise.allSettled(notifIds.map(id => write(id)));
  results.forEach(result => {
    if (result.status !== 'rejected') return;
    report(result.reason, isPermissionDenied(result.reason) ? BENIGN_KIND_MANY : 'markAllRead');
  });
}
