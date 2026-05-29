import type { WatchStatus, MediaType } from '@/types';

// Lazy migration mellan tre schema-versioner:
//
// v1 — engelska + dropped-flag (pre Sprint 1):
//   watching | want_to_watch | watched | dropped (+ data.dropped: boolean)
//
// v2 — svenska + dropped-flag (Sprint 1 → Sprint 7):
//   följer | vill_se | sedd | avbruten (+ data.dropped: boolean fortfarande)
//
// v3 — TV-aware, nuvarande (preprod-refactor):
//   vill_se | mina | sedd (film) | avbruten
//
// Migration sker lazy i WatchlistContext.docToItem och usePublicProfile.
// Firestore-docs skrivs aldrig om bara för migration — först när användaren
// ändrar något på en titel skrivs den med nya schemat.
//
// Pure function, exporterad så test kan kovera mappnings-tabellen
// utan att starta hela contexten.
export function migrateStatus(
  raw: string,
  mediaType: MediaType,
  droppedFlag?: boolean,
): { status: WatchStatus; dropped: boolean } {
  if (droppedFlag) return { status: 'avbruten', dropped: false };
  const isTv = mediaType === 'tv';
  switch (raw) {
    case 'watching':
    case 'följer':
      return { status: isTv ? 'mina' : 'sedd', dropped: false };
    case 'want_to_watch':
    case 'vill_se':
      return { status: 'vill_se', dropped: false };
    case 'watched':
    case 'sedd':
      return { status: isTv ? 'mina' : 'sedd', dropped: false };
    case 'dropped':
    case 'avbruten':
      return { status: 'avbruten', dropped: false };
    case 'mina':
      // Film har inget 'mina'-läge — downgrade till terminal 'sedd'. TV behåller.
      return { status: isTv ? 'mina' : 'sedd', dropped: false };
    default:
      // Okänd/oväntad status (handredigerad doc, framtida schema, typo): defaulta
      // till 'vill_se' för BÅDE film och TV. Tidigare promotades TV tyst till
      // 'mina' (aktiv samling utan progress) vilket fick titeln att dyka upp som
      // 'aktiv' och nudga användaren att titta på något hen aldrig lagt till (M2).
      return { status: 'vill_se', dropped: false };
  }
}
