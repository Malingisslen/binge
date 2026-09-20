// BIN-1170: skrivvägarna för notisernas läs-status, brutna ur hooken så de går
// att pröva utan en Firebase-import i testmiljön (samma mönster som
// `useMarkSeen.helpers.ts`).
//
// Två egenskaper hänger på den här filen, och båda har ett eget test:
//
// 1. `not-found` rapporteras inte: raden är då redan borta ur den lyssnande
//    listan, så användaren ser rätt sak. Allt annat rapporteras, eftersom
//    knapparna i `TopbarActions` är fire-and-forget och ett avvisat löfte
//    annars inte syns någonstans. Vilken felkod en uppdatering mot en raderad
//    notis faktiskt ger är inte mätt — BIN-1251.
// 2. "Markera alla som lästa" skrev tidigare en atomisk `writeBatch`. En
//    uppdatering av ett dokument som hunnit raderas faller på Firestores egen
//    existenskontroll, och eftersom bunten är atomisk markerades då ingen av de
//    övriga heller — klockan stod kvar på sitt fulla antal. Skrivningarna går
//    därför en och en.

export type NotificationWrite = (notifId: string) => Promise<unknown>;
export type WriteFailureReporter = (error: unknown, kind: string) => void;

/** `not-found` betyder att notisen redan är borta — väntat, inte ett fel att larma om. */
export function isBenignWriteFailure(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'not-found';
}

/** Markera en notis som läst. Ett avvisat löfte rapporteras, inget kastas vidare. */
export async function markOneRead(
  write: NotificationWrite,
  notifId: string,
  report: WriteFailureReporter,
): Promise<void> {
  try {
    await write(notifId);
  } catch (error) {
    if (!isBenignWriteFailure(error)) report(error, 'markRead');
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
    if (result.status === 'rejected' && !isBenignWriteFailure(result.reason)) {
      report(result.reason, 'markAllRead');
    }
  });
}
