import type { WatchStatus, MediaType } from '@/types';

// Lazy migration mellan tre schema-versioner:
//
// v1 — engelska + dropped-flag (pre Sprint 1):
//   watching | want_to_watch | watched | dropped (+ data.dropped: boolean)
//
// v2 — svenska + dropped-flag (Sprint 1 → Sprint 7):
//   följer | vill_se | sedd | avbruten (+ data.dropped: boolean fortfarande)
//
// v3 — TV-aware, nuvarande (preprod-refactor; vill_se film-only sedan 2026-06):
//   vill_se (film) | mina (TV) | sedd (film) | avbruten
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
      // TV: vill_se är avskaffat som lagrad status (2026-06) — serien följs
      // och hamnar i läget 'ej_paborjad' (ingen progress). Film behåller
      // vill_se. Firestore-docs med TV-vill_se kan ligga kvar länge; alla
      // läsare normaliserar hit.
      return { status: isTv ? 'mina' : 'vill_se', dropped: false };
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
      // Okänd/oväntad status (handredigerad doc, framtida schema, typo):
      // film → 'vill_se'. TV → 'mina' — säkert numera eftersom mina utan
      // progress härleds till 'ej_paborjad' (M2-fantombuggen som motiverade
      // vill_se-defaulten är borta i och med ej_paborjad-läget).
      return { status: isTv ? 'mina' : 'vill_se', dropped: false };
  }
}
