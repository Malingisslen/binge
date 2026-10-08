import { TMDB_ATTRIBUTION_EN, JUSTWATCH_ATTRIBUTION_EN } from '@/lib/tmdb/attribution';
import { collectUserDataSnapshots } from './userData';
import { captureError } from '@/lib/sentry';
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
// 2.2 (BIN-1172, 2026-09-13): additive — new `groupMemberRows` array (your own
//     groups/{gid}/members/{uid} row per group; id = groupId). The account deletion
//     already erased that row; the export never carried it.
// 2.3 (BIN-1337, 2026-09-28): additive — new `groupTitleRatings` array: your OWN rating
//     on each title in each group's list (id = "<groupId>/<titleId>"). Only your own
//     value from `memberRatings` is carried, never the map and never another member's.
// 2.4 (BIN-1357, 2026-09-30): additive — new `skippedGroups` array: each group whose
//     household, member-row or title-list read threw, with the export fields that lack
//     that group's data. Before this the group was dropped without a trace.
export const SCHEMA_VERSION = '2.4' as const;

export interface ExportDoc {
  id: string;
  data: Record<string, unknown>;
}

/** The group-scoped export fields whose per-group read can fail without failing the export. */
export type GroupScopedExportField = 'householdContributions' | 'groupMemberRows' | 'groupTitleRatings';

/** BIN-1357: a group whose read threw, so the named fields lack that group's data. */
export interface SkippedGroup {
  groupId: string;
  groupName: string | null;
  missing: GroupScopedExportField[];
}

export interface BingeExport {
  schemaVersion: typeof SCHEMA_VERSION;
  exportedAt: string;
  userId: string;
  readme: string;
  // BIN-1357: grupper vars läsning fallerade. Står en grupp här saknas dess data i
  // fälten under `missing`, och filen är ofullständig för den gruppen.
  skippedGroups: SkippedGroup[];
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
  // BIN-1172: min egen medlemsrad i varje grupp. id är groupId.
  groupMemberRows: ExportDoc[];
  // BIN-1337: mitt eget betyg per titel i varje grupps lista. id är "<groupId>/<titelns doc-id>".
  groupTitleRatings: ExportDoc[];
}

const README_TEXT = `Detta är en GDPR Art. 20-export av dina personuppgifter från Binge.nu.

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
- Din egen medlemsrad i varje grupp, som gruppens medlemmar kan läsa (groupMemberRows)
- Dina egna betyg på titlar i gruppernas listor, som gruppens medlemmar kan se (groupTitleRatings)
- Grupper vars data inte gick att läsa när filen skapades (skippedGroups)

Om läsningen av en grupps hushållsbidrag, din medlemsrad eller gruppens titellista
misslyckas när filen skapas, hoppas den delen över i stället för att hela exporten
avbryts. Gruppen står då i "skippedGroups" med sitt id, sitt namn och de fält som
saknar gruppens data ("missing"). För en sådan grupp är filen ofullständig —
exportera gärna igen senare.

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

// BIN-1379: the failed read keeps its error so it can be reported after the export is
// assembled. Reporting inside this catch would let a throwing reporter reject the
// Promise.all the swallow exists to protect.
class ReadFailed {
  constructor(readonly error: unknown) {}
}

function orReadFailed<T>(read: Promise<T>): Promise<T | ReadFailed> {
  return read.catch((error: unknown) => new ReadFailed(error));
}

const READ_FAILURE_KIND: Record<GroupScopedExportField, string> = {
  householdContributions: 'dataExport-householdRead',
  groupMemberRows: 'dataExport-memberRowRead',
  groupTitleRatings: 'dataExport-titleListRead',
};

// BIN-1379: one event per failing read kind per export, carrying the first failure's
// own error (so beforeSend scrubs its path) and a bare count. Never a group id, a group
// name or a uid: `extra` is not scrubbed. Best effort; a failure here never reaches
// the user's export.
function reportReadFailures(failures: Map<GroupScopedExportField, { error: unknown; count: number }>): void {
  failures.forEach(({ error, count }, field) => {
    const kind = READ_FAILURE_KIND[field];
    try {
      console.error('dataExport: en gruppläsning fallerade (' + kind + ')', error);
      captureError(error, { scope: 'groups', kind, extra: { failedGroups: count } });
    } catch {
      // Monitoring must not turn a delivered export into a failed one (BIN-1166).
    }
  });
}

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
  //
  // BIN-1172: min egen medlemsrad hämtas på samma sätt, här och inte i den delade
  // hjälparen.
  //
  // Sökvägens sista segment är alltid `uid`, den inloggade användarens eget. Reglerna
  // låter en medlem läsa VARJE medlems rad, så det är den här raden som håller
  // exporten till ens egen. En rad som saknas (en spökmedlem, BIN-1097) eller en
  // läsning som fallerar hoppas över i stället för att fälla hela exporten.
  //
  // BIN-1337: mina betyg på gruppens titlar läses ur hela titellistan, eftersom betyget
  // ligger i en map på varje rad. Varje grupps läsning fångas för sig, så en nekad lista
  // fäller inte de andra grupperna. Anropas bara med den inloggades eget uid
  // (`DataExportSection`): reglerna prövar medlemskap, inte att uid:t är anroparens,
  // så ett annat uid skulle exportera den medlemmens betyg.
  //
  // BIN-1357: en läsning som kastar fångas som ReadFailed i stället för null, så att
  // gruppen kan märkas i `skippedGroups`. En rad som bara saknas är inget fel och märks inte.
  const householdContributions: ExportDoc[] = [];
  const groupMemberRows: ExportDoc[] = [];
  const groupTitleRatings: ExportDoc[] = [];
  const skippedGroups: SkippedGroup[] = [];
  const readFailures = new Map<GroupScopedExportField, { error: unknown; count: number }>();
  const noteFailure = (field: GroupScopedExportField, failed: ReadFailed) => {
    const seen = readFailures.get(field);
    if (seen) seen.count += 1;
    else readFailures.set(field, { error: failed.error, count: 1 });
  };
  if (s.groupsSnap.docs.length > 0) {
    const { fsdb } = await import('./db');
    const { db, doc, getDoc, collection, getDocs } = await fsdb();
    const [householdSnaps, memberSnaps, titleSnaps] = await Promise.all([
      Promise.all(s.groupsSnap.docs.map(g =>
        orReadFailed(getDoc(doc(db, 'groups', g.id, 'household', uid))))),
      Promise.all(s.groupsSnap.docs.map(g =>
        orReadFailed(getDoc(doc(db, 'groups', g.id, 'members', uid))))),
      Promise.all(s.groupsSnap.docs.map(g =>
        orReadFailed(getDocs(collection(db, 'groups', g.id, 'watchlist'))))),
    ]);
    s.groupsSnap.docs.forEach((g, i) => {
      const missing: GroupScopedExportField[] = [];
      const snap = householdSnaps[i];
      if (snap instanceof ReadFailed) {
        missing.push('householdContributions');
        noteFailure('householdContributions', snap);
      } else if (snap.exists()) {
        householdContributions.push({ id: g.id, data: snap.data() as Record<string, unknown> });
      }
      const member = memberSnaps[i];
      if (member instanceof ReadFailed) {
        missing.push('groupMemberRows');
        noteFailure('groupMemberRows', member);
      } else if (member.exists()) {
        groupMemberRows.push({ id: g.id, data: member.data() as Record<string, unknown> });
      }
      const titles = titleSnaps[i];
      if (titles instanceof ReadFailed) {
        missing.push('groupTitleRatings');
        noteFailure('groupTitleRatings', titles);
      } else {
        groupTitleRatings.push(...ownGroupTitleRatings(
          g.id,
          titles.docs.map(t => ({ id: t.id, data: t.data() as Record<string, unknown> })),
          uid,
        ));
      }
      if (missing.length > 0) {
        const name = (g.data() as Record<string, unknown> | undefined)?.name;
        skippedGroups.push({ groupId: g.id, groupName: typeof name === 'string' ? name : null, missing });
      }
    });
  }
  reportReadFailures(readFailures);

  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    userId: uid,
    readme: README_TEXT,
    skippedGroups,
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
    groupMemberRows,
    groupTitleRatings,
  };
}

/**
 * BIN-1337: the exporting user's own rating on each of one group's title rows. A row
 * without the user's key yields nothing; a row with it yields ONLY that value — other
 * members' ratings in the same map never leave this function.
 */
export function ownGroupTitleRatings(
  groupId: string,
  rows: ExportDoc[],
  uid: string,
): ExportDoc[] {
  const out: ExportDoc[] = [];
  for (const row of rows) {
    const ratings = row.data.memberRatings;
    if (typeof ratings !== 'object' || ratings === null || Array.isArray(ratings)) continue;
    if (!Object.prototype.hasOwnProperty.call(ratings, uid)) continue;
    out.push({
      id: `${groupId}/${row.id}`,
      data: {
        groupId,
        titleId: row.id,
        tmdbId: row.data.tmdbId ?? null,
        mediaType: row.data.mediaType ?? null,
        title: row.data.title ?? null,
        rating: (ratings as Record<string, unknown>)[uid],
      },
    });
  }
  return out;
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
