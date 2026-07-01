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
export const SCHEMA_VERSION = '1.1' as const;

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
  watchlist: ExportDoc[];
  watchlistTags: ExportDoc[];
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
}

const README_TEXT = `Detta är en komplett GDPR Art. 20-export av dina personuppgifter från Binge.nu.

Filen innehåller:
- Din profil (profile)
- Alla titlar i din watchlist, inklusive status och betyg (watchlist)
- Dina egna taggar per titel (watchlistTags)
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

  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    userId: uid,
    readme: README_TEXT,
    tmdbAttribution: TMDB_ATTRIBUTION_EN,
    justwatchAttribution: JUSTWATCH_ATTRIBUTION_EN,
    profile: s.profileSnap.exists() ? (s.profileSnap.data() as Record<string, unknown>) : null,
    watchlist: toExportDocs(s.watchlistSnap),
    watchlistTags: toExportDocs(s.watchlistTagsSnap),
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
