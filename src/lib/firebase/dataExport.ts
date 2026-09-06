import { TMDB_ATTRIBUTION_EN, JUSTWATCH_ATTRIBUTION_EN } from '@/lib/tmdb/attribution';
import { collectUserDataSnapshots } from './userData';
import type { QuerySnapshot } from 'firebase/firestore';

/**
 * GDPR Art. 20 — personal data export.
 *
 * Kör helt klient-side så Firestore-reglerna gate:ar läsningen (varje
 * klient kan bara läsa sin egen data). Bump SCHEMA_VERSION vid breaking
 * changes — framtida consumers ska kunna tolka äldre exports.
 */

// 1.1 (BIN-164): additive — new `watchlistTags` array (your private per-title tags).
// 1.2 (BIN-184): additive — new `householdContributions` array (your opt-in shared
//     subscription data per group; id = groupId). Self-reported financial data →
//     squarely Art. 20 scope.
// 1.3 (BIN-505): additive — new `watchlistNotes` array (your private per-title notes,
//     moved off the public watchlist doc) + `publicProfile` (the public projection doc).
// 2.0 (BIN-560, 2026-07-22): MAJOR — CHANGE OF FIELD MEANING (not additive). The `id`
//     on every personal-library doc (watchlist, watchlistTags, watchlistNotes,
//     episodeProgress, notInterested) now encodes BOTH the media type and the TMDB id
//     as `${mediaType}_${tmdbId}` (e.g. "movie_603", "tv_1399") instead of the bare
//     numeric tmdbId. A consumer that parsed `id` as a number will break — split on the
//     first "_" to recover mediaType + tmdbId (or read the `tmdbId`/`mediaType` fields in
//     the doc body, which carry them explicitly). Bumped MAJOR so old parsers fail loudly
//     rather than silently mis-key a movie as a same-numbered show.
// 2.1 (BIN-1063, 2026-09-06): additive — `friends` and `friendRequestsSent` docs now
//     carry a `uid` field holding the counterparty's uid. It duplicates the doc `id`;
//     it exists so a collection-group query can find the row, which the id alone
//     cannot answer. No field changed meaning.
export const SCHEMA_VERSION = '2.1' as const;

export interface ExportDoc {
  id: string;
  data: Record<string, unknown>;
}

export interface BingeExport {
  schemaVersion: typeof SCHEMA_VERSION;
  exportedAt: string;
  userId: string;
  readme: string;
  tmdbAttribution: string;
  justwatchAttribution: string;
  profile: Record<string, unknown> | null;
  // BIN-505: the public projection doc (publicProfiles/{uid}) — the public-safe
  // display fields other users can see. null if never backfilled.
  publicProfile: Record<string, unknown> | null;
  watchlist: ExportDoc[];
  watchlistTags: ExportDoc[];
  // BIN-505: your private per-title notes (owner-only watchlistNotes subcollection).
  watchlistNotes: ExportDoc[];
  episodeProgress: ExportDoc[];
  notInterested: ExportDoc[];
  notifications: ExportDoc[];
  blocked: ExportDoc[];
  following: ExportDoc[];
  followers: ExportDoc[];
  friends: ExportDoc[];
  friendRequests: ExportDoc[];
  friendRequestsSent: ExportDoc[];
  groupInvites: ExportDoc[];
  pauseHistory: ExportDoc[];
  listFollows: ExportDoc[];
  reviews: ExportDoc[];
  reviewLikes: ExportDoc[];
  reviewComments: ExportDoc[];
  episodeReactions: ExportDoc[];
  lists: ExportDoc[];
  editableLists: ExportDoc[];
  sessions: ExportDoc[];
  groupMemberships: ExportDoc[];
  // BIN-184: mina hushålls-bidrag (delade kostnadsdata), ett per grupp där jag
  // opt:at in — id är groupId (doc-id:t i gruppen är alltid min egen uid).
  householdContributions: ExportDoc[];
}

const README_TEXT = `Detta är en komplett GDPR Art. 20-export av dina personuppgifter från Binge.nu.

Filen innehåller:
- Din profil (profile)
- Din publika profil-projektion som andra ser (publicProfile)
- Alla titlar i din watchlist, inklusive status och betyg (watchlist)
- Dina egna taggar per titel (watchlistTags)
- Dina egna anteckningar per titel (watchlistNotes)
- Episode-progress för serier (episodeProgress)
- "Inte intresserad"-listan (notInterested)
- Notifikationer (notifications)
- Blockerade användare (blocked)
- Användare du följer (following)
- Användare som följer dig (followers)
- Dina vänner (friends)
- Inkomna vänförfrågningar (friendRequests)
- Skickade vänförfrågningar (friendRequestsSent)
- Inkomna grupp-inbjudningar (groupInvites)
- Sparbeslut-historik från Streamingrådgivaren (pauseHistory)
- Dina recensioner (reviews)
- Gillamarkeringar du gjort (reviewLikes)
- Kommentarer du skrivit (reviewComments)
- Dina avsnitts-reaktioner (episodeReactions)
- Dina listor (lists)
- Listor du är medredigerare i (editableLists)
- Listor du följer (listFollows)
- Tillsammans-sessioner du är värd för (sessions)
- Grupper du är medlem i (groupMemberships)

Datumfält serialiseras som Firestore-timestamps; om du re-importerar måste
de konverteras tillbaka. Schema-version framgår i "schemaVersion".

OBS (schema 2.0): "id"-fältet på dina titel-poster (watchlist, watchlistTags,
watchlistNotes, episodeProgress, notInterested) kodar nu BÅDE medietyp och
TMDB-id som "\${medietyp}_\${tmdbId}" — t.ex. "movie_603" eller "tv_1399" — i
stället för bara siffran. Det beror på att en film och en serie kan dela samma
TMDB-nummer; det här håller dem åtskilda. Vill du ha bara siffran: dela på det
första "_". Fälten "tmdbId" och "mediaType" i själva posten innehåller dem också.

Metadata om filmer och serier (titel, poster, genrer etc.) kommer från
TMDB och är inte dina personuppgifter — vi cachear dem på watchlist-items
som bekvämlighet, men källan är TMDB.`;

function toExportDocs(snap: QuerySnapshot): ExportDoc[] {
  return snap.docs.map(d => ({
    id: d.id,
    data: d.data() as Record<string, unknown>,
  }));
}

export async function buildUserExport(uid: string): Promise<BingeExport> {
  const s = await collectUserDataSnapshots(uid);

  // BIN-184: hushålls-bidrag är grupp-scopade (groups/{gid}/household/{uid}) och
  // ingår därför inte i den users/{uid}-formade helpern — hämtas inline här,
  // samma mönster som joinAttempts hanteras inline i deleteAccount. Ett getDoc
  // per grupp jag är medlem i; bara existerande (opt-in) docs exporteras.
  // Dynamisk ./db-import: laddas bara när det finns grupper, så modulgrafen
  // förblir Firebase-fri för test/miljöer som mockar userData (BIN-328-guarden).
  const householdContributions: ExportDoc[] = [];
  if (s.groupsSnap.docs.length > 0) {
    const { fsdb } = await import('./db');
    const { db, doc, getDoc } = await fsdb();
    const householdSnaps = await Promise.all(
      s.groupsSnap.docs.map(g => getDoc(doc(db, 'groups', g.id, 'household', uid))),
    );
    s.groupsSnap.docs.forEach((g, i) => {
      const snap = householdSnaps[i];
      if (snap.exists()) {
        householdContributions.push({ id: g.id, data: snap.data() as Record<string, unknown> });
      }
    });
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    userId: uid,
    readme: README_TEXT,
    tmdbAttribution: TMDB_ATTRIBUTION_EN,
    justwatchAttribution: JUSTWATCH_ATTRIBUTION_EN,
    profile: s.profileSnap.exists() ? (s.profileSnap.data() as Record<string, unknown>) : null,
    publicProfile: s.publicProfileSnap.exists() ? (s.publicProfileSnap.data() as Record<string, unknown>) : null,
    watchlist: toExportDocs(s.watchlistSnap),
    watchlistTags: toExportDocs(s.watchlistTagsSnap),
    watchlistNotes: toExportDocs(s.watchlistNotesSnap),
    episodeProgress: toExportDocs(s.episodeProgressSnap),
    notInterested: toExportDocs(s.notInterestedSnap),
    notifications: toExportDocs(s.notificationsSnap),
    blocked: toExportDocs(s.blockedSnap),
    following: toExportDocs(s.followingSnap),
    followers: toExportDocs(s.followersSnap),
    friends: toExportDocs(s.friendsSnap),
    friendRequests: toExportDocs(s.friendRequestsSnap),
    friendRequestsSent: toExportDocs(s.friendRequestsSentSnap),
    groupInvites: toExportDocs(s.groupInvitesSnap),
    pauseHistory: toExportDocs(s.pauseHistorySnap),
    listFollows: toExportDocs(s.listFollowsSnap),
    reviews: toExportDocs(s.reviewsSnap),
    reviewLikes: toExportDocs(s.reviewLikesSnap),
    reviewComments: toExportDocs(s.reviewCommentsSnap),
    episodeReactions: toExportDocs(s.episodeReactionsSnap),
    lists: toExportDocs(s.listsSnap),
    editableLists: toExportDocs(s.editableListsSnap),
    sessions: toExportDocs(s.sessionsSnap),
    groupMemberships: toExportDocs(s.groupsSnap),
    householdContributions,
  };
}

export function downloadExport(data: BingeExport): void {
  if (typeof window === 'undefined') return;

  // Ingen pretty-print: halvtar memory footprint för stora watchlists.
  // En användare som vill läsa exporten kan re-formattera med `jq .` eller
  // textredigerare.
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const uidPrefix = data.userId.slice(0, 8);
  const date = data.exportedAt.slice(0, 10);
  const filename = `binge-export-${uidPrefix}-${date}.json`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Deferra revoke — Safari har historiskt krävt detta för att nedladdningen
  // ska hinna pickas upp innan blob-referensen släpps.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
