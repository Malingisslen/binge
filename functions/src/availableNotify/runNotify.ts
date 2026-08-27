/**
 * The availableNotify ORCHESTRATOR — both phases of the daily watchlist push job,
 * lifted out of index.ts so a test can drive them (BIN-727 step 2).
 *
 * Why it lives here and not in index.ts: index.ts imports firebase-admin +
 * firebase-functions, and NEITHER is installed in the root toolchain (`npm ci` at
 * the repo root is all CI's `rules-tests` job installs — see
 * .github/workflows/deploy.yml). So any file the emulator harness must import has to
 * be admin-free, exactly like ./logic.ts and ../releaseNotify/logic.ts. This
 * module therefore takes ALL of its outside world as one injected PORT
 * (`NotifyIo`) and imports nothing but pure siblings — index.ts implements the
 * port with the Admin SDK + real TMDB + real FCM,
 * `src/test/rules/available-notify-orchestrator.test.ts` implements it with the
 * client SDK against a real Firestore emulator plus in-memory TMDB and push
 * doubles. Same pattern as retentionCleanup/runCleanup.ts (BIN-727 step 1) and
 * tmdbTosSweep/runSweep.ts (BIN-566).
 *
 * WHAT MAKES THIS ONE HEAVIER THAN ITS TWO PRECEDENTS (#13 Data/Integrations
 * Engineer, 2026-08-15): those sweeps touch only Firestore. This job crosses two
 * FURTHER boundaries — TMDB fetches and a real FCM send via sendPushToUser — and
 * there is no FCM emulator. Both therefore go through the port too. That is not
 * tidiness: the ticket's own acceptance criterion is "a user who opted out never
 * reaches sendPushToUser", and with FCM behind the port that is provable by
 * COUNTING CALLS instead of being inferred from the absence of a side effect.
 *
 * Everything Firestore-, TMDB- or FCM-SHAPED (queries, `.select()` projections,
 * serverTimestamp stamping, `fetch`, `getMessaging`) stays in the port.
 * Everything the job DECIDES lives here, under test:
 *   - paging and cursor advance for the bounded watchlist scan
 *   - the uid / tmdbId / mediaType derivation from each watchlist doc's path
 *   - phase 1 completing BEFORE phase 2 reads its skip set (the cross-phase dedup
 *     that stops a double push on an overlap day)
 *   - the legacy `availableNotifyState/{tmdbId}` fallback read, and that a
 *     successful run always writes forward to the namespaced doc
 *   - baseline-only on first observation; the marker advancing on every
 *     successful fetch regardless of individual send outcomes
 *   - the release cache TTL, the catch-up fire window, and the per-user marker
 *   - which failures are isolated to one recipient, one title, or one phase
 *
 * The two outer loops are SEQUENTIAL on purpose and must stay that way: they are
 * the only thing bounding this job's TMDB request rate, and parallelising them
 * would be a quota change smuggled inside a testability ticket (#13's refusal).
 */

import {
  diffNewProviders,
  qualifyingProviders,
  canonicalProviderId,
  normalizeMediaType,
  availableStateDocId,
  inboxNotifId,
  type WatchlistTitleLite,
  type UserNotifSettings,
} from './logic';
import {
  seDigitalReleaseDates,
  stockholmDateString,
  shouldRefetchReleaseDates,
  releaseDateToFire,
  releaseAction,
  isLegacyReleaseCard,
  type ReleaseDateCache,
  type TmdbReleaseDatesCountry,
} from '../releaseNotify/logic';
import { resolveTmdbId } from '../shared/mediaTypeDocId';

/** One scanned watchlist document, flattened to path + fields. */
export interface ScanDoc {
  /** Full Firestore path, `users/{uid}/watchlist/{docId}`. Also the page cursor. */
  readonly path: string;
  /** The `.select()`-narrowed field map. */
  readonly data: Record<string, unknown>;
}

/** An arbitrary Firestore document's fields, as read back. */
export type DocData = Record<string, unknown>;

/** One SE flatrate provider, as TMDB reports it. */
export interface SeProvider { readonly id: number; readonly name: string }

/** What the port sends to FCM. Mirrors push.ts's NotifPayload. */
export interface PushPayload {
  readonly title: string;
  readonly body: string;
  readonly actionUrl: string;
  readonly tag: string;
}

/** The fields of an inbox card; the port stamps `createdAt` itself. */
export type NotificationCard = Record<string, unknown>;

/**
 * The subset of firebase-functions' logger this job uses. Deliberately just the
 * two levels the orchestrator actually calls — `warn` belongs to the port's own
 * TMDB helpers, which log their failures before returning null, and declaring it
 * here would imply this loop warns about something it never does.
 */
export interface NotifyLogger {
  info(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

/**
 * The injected port. Deliberately primitive: every method maps 1:1 to ONE
 * Firestore read/write, ONE TMDB fetch or ONE push send, so a port implementation
 * has nowhere to hide a decision — and so a test can count sends.
 */
export interface NotifyIo {
  /** Watchlist docs per scan page. Prod passes the real PAGE_SIZE; tests page smaller. */
  readonly pageSize: number;
  readonly log: NotifyLogger;
  /**
   * Wall clock, injected so the release window and the cache TTL are drivable.
   * A `Date`, not the epoch-ms its retentionCleanup sibling injects, because
   * `stockholmDateString` needs the Intl formatter's own Date.
   */
  now(): Date;

  /** One ordered page of the `watchlist` collection group, after `cursor` (a path). */
  scanWatchlistPage(cursor: string | null, pageSize: number): Promise<readonly ScanDoc[]>;

  /** `availableNotifyState/{docId}`, or null when absent. */
  readAvailableState(docId: string): Promise<DocData | null>;
  /** Merge `lastFlatrate` into `availableNotifyState/{docId}`; the port stamps `updatedAt`. */
  writeAvailableState(docId: string, lastFlatrate: readonly number[]): Promise<void>;

  /** `releaseNotifyState/{tmdbId}`, or null when absent. */
  readReleaseCache(tmdbId: number): Promise<DocData | null>;
  /** Merge the resolved dates in; the port stamps `datesResolvedAt` + `updatedAt`. */
  writeReleaseCache(tmdbId: number, seDigitalDates: readonly string[]): Promise<void>;

  /** `releaseNotifyState/{tmdbId}/notified/{uid}`, or null when absent. */
  readReleaseMarker(tmdbId: number, uid: string): Promise<DocData | null>;
  /** Merge `notifiedDate` in; the port stamps `updatedAt`. */
  writeReleaseMarker(tmdbId: number, uid: string, notifiedDate: string): Promise<void>;

  /** `users/{uid}/notifications/{notifId}`, or null when absent. */
  readNotification(uid: string, notifId: string): Promise<DocData | null>;
  /** Merge an inbox card into `users/{uid}/notifications/{notifId}`; port stamps `createdAt`. */
  writeNotification(uid: string, notifId: string, card: NotificationCard): Promise<void>;

  /** `users/{uid}`, or null when the profile document is missing. */
  readUserDoc(uid: string): Promise<DocData | null>;

  /** SE flatrate providers for a title; null on ANY failure (caller skips the title). */
  fetchSeFlatrate(tmdbId: number, mediaType: string): Promise<readonly SeProvider[] | null>;
  /** A movie's raw `/release_dates` country blocks; null on ANY failure. */
  fetchReleaseDates(tmdbId: number): Promise<TmdbReleaseDatesCountry[] | null>;

  /** Send one push. The pushEnabled gate is passed through, exactly like push.ts. */
  sendPush(uid: string, payload: PushPayload, opts: { pushEnabled: boolean }): Promise<void>;
}

/** Everything the run reports, returned as well as logged so a test can read it. */
export interface NotifySummary {
  /** Watchlist docs scanned across all pages. */
  watchlistDocs: number;
  /** Distinct (mediaType, tmdbId) groups the availability phase visited. */
  uniqueTitles: number;
  /** Availability pushes sent (phase 2). */
  notified: number;
  /** (uid, movie) pairs the release phase claimed, and phase 2 therefore skipped. */
  releaseOwned: number;
  /** "Släpps idag" pushes sent (phase 1). */
  releaseNotified: number;
  /** Per-user markers seeded at the BIN-472 cutover WITHOUT a push. */
  releaseSeeded: number;
}

/**
 * Key for the release-phase suppression set: a specific user's specific title.
 * Keyed by mediaType too: TMDB movie ids and TV ids are independent namespaces,
 * so a user can hold movie N and TV N. Without mediaType, a movie's release skip
 * would wrongly suppress the unrelated TV show's availability push.
 */
export const skipKey = (uid: string, mediaType: string, tmdbId: number): string =>
  `${uid}:${mediaType}:${tmdbId}`;

/** The uid that owns `users/{uid}/watchlist/{docId}`, or '' if the path is not that shape. */
function uidFromWatchlistPath(path: string): string {
  const parts = path.split('/');
  return parts.length >= 4 && parts[0] === 'users' ? parts[1] : '';
}

/** The document id of any Firestore path. */
function docIdFromPath(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] ?? '';
}

/**
 * BIN-515: bounded scan. The old single `.get()` materialized the whole matching
 * collection-group in one query — an uncapped read-bill that can breach
 * Firestore's 10 MB single-response limit at scale (a hard error that aborts the
 * entire notify run, dropping every availability + "släpps idag" push). Pages of
 * `pageSize`, ordered by document id, cursored on the last doc's path.
 *
 * The uid comes from the doc's own PATH and the tmdbId falls back to the doc id
 * (`resolveTmdbId`) — both derivations live here rather than in the port because
 * a wrong one is silent: an empty uid reads every user's title as one stranger's,
 * and a missing tmdbId collapses distinct titles onto id 0.
 */
async function readWatchlistTitles(io: NotifyIo): Promise<WatchlistTitleLite[]> {
  const out: WatchlistTitleLite[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page = await io.scanWatchlistPage(cursor, io.pageSize);
    if (page.length === 0) break;
    for (const d of page) {
      const x = d.data;
      out.push({
        uid: uidFromWatchlistPath(d.path),
        tmdbId: resolveTmdbId(x.tmdbId as number | string | null | undefined, docIdFromPath(d.path)),
        mediaType: String(x.mediaType ?? ''),
        status: String(x.status ?? ''),
        title: String(x.title ?? ''),
      });
    }
    if (page.length < io.pageSize) break;
    cursor = page[page.length - 1].path;
  }
  return out;
}

/** `lastFlatrate` as a clean number array, or null when the field is absent/unusable. */
function lastFlatrateOf(data: DocData | null): number[] | null {
  const v = data?.lastFlatrate;
  return Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : null;
}

/**
 * stateId = availableStateDocId(mediaType, tmdbId) — media-type-namespaced
 * (BIN-523).
 *
 * xhigh /code-review (2026-07-19) caught a real gap in the ORIGINAL BIN-523
 * framing: "legacy bare-tmdbId docs are orphaned on purpose" is only true
 * for titles that actually COLLIDED (their old doc's lastFlatrate may
 * genuinely mix both media's providers). For the much larger set of titles
 * that never collided, the old doc's data is perfectly valid — but keying
 * purely on the new stateId meant EVERY title's first post-deploy run saw
 * `last === null` regardless, silently swallowing any real "now streaming"
 * transition that happened to land in that one run (diffNewProviders takes
 * the baseline-only branch on a null `last`, by design, to avoid a false
 * first-run blast). Reading `tmdbId` (the legacy key) as a fallback ONLY
 * when the namespaced doc doesn't exist yet fixes the common (non-colliding)
 * case at the cost of reintroducing the ORIGINAL (already-accepted, already
 * self-correcting) mixed-baseline risk for the rare colliding case — for one
 * SUCCESSFUL run only. `writeMarker` (below) always writes forward to the
 * namespaced doc once a fetch actually succeeds, so every subsequent
 * successful run reads clean, correctly-scoped state. A title whose fetch
 * keeps FAILING never even reaches this function — processTitle returns
 * early on a null fetch, before readLastFlatrate is called — so it's not a
 * repeated-fallback case at all, just an unrelated, pre-existing "skip this
 * run" outcome.
 *
 * The EXISTENCE test is what makes the fallback one-shot, so it is deliberately
 * "did the namespaced document exist at all", not "did it carry a usable
 * lastFlatrate": a namespaced doc written by a run that found zero providers
 * holds `[]`, and falling back past it would resurrect a stale baseline forever.
 */
async function readLastFlatrate(io: NotifyIo, stateId: string, legacyTmdbId: number): Promise<number[] | null> {
  const state = await io.readAvailableState(stateId);
  if (state !== null) return lastFlatrateOf(state);
  return lastFlatrateOf(await io.readAvailableState(String(legacyTmdbId)));
}

/** The cached SE digital dates + when they were resolved (BIN-463), normalized. */
function releaseCacheOf(data: DocData | null): ReleaseDateCache | null {
  if (data === null) return null;
  const seDigitalDates = Array.isArray(data.seDigitalDates)
    ? data.seDigitalDates.filter((x: unknown): x is string => typeof x === 'string')
    : [];
  // Both the Admin and the client SDK expose Timestamp.toMillis(); anything else
  // (a missing stamp, a hand-written number) reads as "never resolved" → refetch.
  const ts = data.datesResolvedAt as { toMillis?: () => number } | undefined | null;
  const datesResolvedAtMs = ts && typeof ts.toMillis === 'function' ? ts.toMillis() : null;
  return { seDigitalDates, datesResolvedAtMs };
}

/** One read of users/{uid} for both myProviders and the notif flags. null = user-doc missing → don't notify. */
function userDataOf(data: DocData | null): { myProviders: number[]; settings: UserNotifSettings } | null {
  if (data === null) return null;
  const s = data.notificationSettings as { availableOnMyServices?: boolean; pushEnabled?: boolean } | undefined;
  const myProviders = Array.isArray(data.myProviders)
    ? data.myProviders.filter((n: unknown): n is number => typeof n === 'number')
    : [];
  return {
    myProviders,
    settings: {
      availableOnMyServices: s?.availableOnMyServices !== false, // default on
      pushEnabled: s?.pushEnabled === true, // default off (must opt in)
    },
  };
}

/**
 * One (mediaType, tmdbId) title's availability transition. Returns how many
 * availability pushes it sent.
 */
async function processTitle(
  io: NotifyIo,
  stateId: string,
  items: readonly WatchlistTitleLite[],
  releaseSkip: ReadonlySet<string>,
): Promise<number> {
  // Groups are keyed on availableStateDocId(mediaType, tmdbId), so every item
  // shares one (mediaType, tmdbId) — items[0] is authoritative, not arbitrary.
  const { tmdbId } = items[0];
  const mediaType = normalizeMediaType(items[0].mediaType);
  const providers = await io.fetchSeFlatrate(tmdbId, mediaType);
  if (providers === null) return 0; // fetch failed → skip, don't touch the marker
  // Canonicalise provider ids (TMDB aliases → one id), matching how the client
  // stores myProviders + keys notif docs. Dedupe by canonical id, first name wins.
  const nameById = new Map<number, string>();
  for (const p of providers) {
    const cid = canonicalProviderId(p.id);
    if (!nameById.has(cid)) nameById.set(cid, p.name);
  }
  const currentIds = [...nameById.keys()];
  const last = await readLastFlatrate(io, stateId, tmdbId);
  const newIds = diffNewProviders(currentIds, last);

  const writeMarker = () => io.writeAvailableState(stateId, currentIds);

  if (newIds.length === 0) { await writeMarker(); return 0; }

  const actionUrl = `/${mediaType}/${tmdbId}/`;
  let notified = 0;
  await Promise.allSettled(items.map(async (it) => {
    // Overlap day: the release phase already sent this user "släpps idag" for this
    // title. DELIBERATELY suppress BOTH the availability push and its
    // provider_available inbox card (return before writing either) so the user
    // gets exactly one signal — the release one (Malin's "prefer släpps idag").
    // The release card links to /movie/{id}/ where the live SE providers show, so
    // "which service" isn't lost. The provider marker still advances below (early
    // return only skips the send/card, not writeMarker), so it won't re-fire.
    //
    // The check is FIRST, before the profile read (#13's condition 6): a
    // release-owned pair must not even construct a push, and "zero calls to the
    // push port" is the only assertion that can prove the dedup rather than infer
    // it from a missing document.
    if (releaseSkip.has(skipKey(it.uid, it.mediaType, it.tmdbId))) return;
    const u = userDataOf(await io.readUserDoc(it.uid));
    if (!u) return;
    const qualifying = qualifyingProviders(u.settings, newIds, u.myProviders);
    if (qualifying.length === 0) return;
    // ONE push per title per availability-transition. If the title gains several
    // of the user's providers in the same run we notify about the first only —
    // "X går att streama nu" is the signal; the title page shows every provider.
    // The marker advances to include ALL current providers, so the others won't
    // re-fire later either. This is deliberate (avoids double-spam for one title).
    const providerId = qualifying[0];
    const providerName = nameById.get(providerId) ?? 'en av dina tjänster';
    // Shape + id MATCH the client/inbox `provider_available` model
    // (useNotifications.ts): kind, providerId (canonical), providerName, and
    // the media-type-namespaced `${stateId}-${canonicalId}` doc id (BIN-529)
    // so a movie and TV show sharing a tmdbId + provider can't merge-overwrite
    // one inbox card.
    const notifId = inboxNotifId(mediaType, tmdbId, providerId);
    await io.writeNotification(it.uid, notifId, {
      tmdbId, mediaType, title: it.title, kind: 'provider_available',
      providerId, providerName, read: false,
    });
    await io.sendPush(it.uid, {
      title: `Nu på din ${providerName}`,
      body: `${it.title} går att streama där nu`,
      // Tag rides the namespaced stateId too — a bare-tmdbId tag would let a
      // movie-N push visually replace an unrelated TV-N push in the browser.
      actionUrl, tag: `available-${stateId}`,
    }, { pushEnabled: u.settings.pushEnabled });
    notified += 1;
  }));
  await writeMarker();
  return notified;
}

/** What the release phase hands to the availability phase. */
interface ReleasePhaseResult {
  skip: Set<string>;
  notified: number;
  seeded: number;
}

/**
 * Release phase (BIN-360 + BIN-463/464). For every vill_se MOVIE (the "bevakad"
 * set — vill_se is film-only) whose SE digital date is today (or within the
 * catch-up grace window), write a "släpps idag" inbox card for each owner and
 * push it to those with pushEnabled. Returns the set of (uid,tmdbId) it owns
 * (fire-window films) so the availability phase can skip them (dedup: release
 * wins). Every owner of a fireable film is added to the skip set regardless of
 * send outcome — that film belongs to the release message, never "finns nu på X".
 *
 * BIN-463: the resolved SE digital dates are cached per title; we only re-hit TMDB
 * when the cache is missing, stale, or a cached date is near release. BIN-464:
 * at-most-once is per-USER via a dedicated non-deletable marker storing the
 * notified date, and the grace window makes a missed cron day self-heal.
 */
async function runReleasePhase(
  io: NotifyIo,
  titles: readonly WatchlistTitleLite[],
  today: string,
  nowMs: number,
): Promise<ReleasePhaseResult> {
  const skip = new Set<string>();
  let notified = 0;
  let seeded = 0;

  // Group each vill_se movie's OWNER DOCS by tmdbId — we keep the per-owner items
  // (not one movie-level title) so each user's card/push carries their own
  // denormalized title, never the first-scanned owner's (which could be blank).
  const byMovie = new Map<number, WatchlistTitleLite[]>();
  for (const t of titles) {
    if (t.status !== 'vill_se' || t.mediaType !== 'movie') continue;
    const arr = byMovie.get(t.tmdbId);
    if (arr) arr.push(t); else byMovie.set(t.tmdbId, [t]);
  }

  for (const [tmdbId, owners] of byMovie) {
    // Isolate each movie (mirrors phase 2's per-title try/catch): a throw in one
    // movie's block must not skip the rest's release-window check NOR discard the
    // skip set built so far.
    try {
      // BIN-463: trust the cached dates unless missing/stale/near-release. On a
      // refetch we re-resolve from TMDB and re-stamp the cache; a fetch failure
      // leaves the cache untouched (retry next run).
      const cache = releaseCacheOf(await io.readReleaseCache(tmdbId));
      let seDigitalDates: string[];
      if (shouldRefetchReleaseDates(cache, today, nowMs)) {
        const results = await io.fetchReleaseDates(tmdbId);
        if (results === null) continue;                  // fetch failed → skip, keep cache
        seDigitalDates = seDigitalReleaseDates(results);
        await io.writeReleaseCache(tmdbId, seDigitalDates); // cache even [] → no daily re-fetch for date-less films
      } else {
        seDigitalDates = cache?.seDigitalDates ?? [];
      }

      const dateToFire = releaseDateToFire(seDigitalDates, today);
      if (dateToFire === null) continue;                 // not in the fire window

      // Fan owners out (matches processTitle's Promise.allSettled) — one slow/
      // failing recipient can't block or abort the others.
      await Promise.allSettled(owners.map(async (it) => {
        skip.add(skipKey(it.uid, 'movie', tmdbId));      // movies only; availability defers for this owner regardless of send outcome
        // BIN-464: per-USER dedup on a NON-deletable marker, not the inbox card.
        // If we already pushed this user for THIS release date, skip — even across
        // the grace window and even if they cleared their inbox. A newer digital
        // date re-arms (dateToFire changes).
        try {
          const markerDoc = await io.readReleaseMarker(tmdbId, it.uid);
          const rawDate = markerDoc?.notifiedDate;
          const notifiedDate = typeof rawDate === 'string' ? rawDate : null;
          // BIN-472: only when there is no marker do we check for a legacy card —
          // the steady state (marker present) never pays for this extra read.
          const hasLegacyCard = notifiedDate === null
            ? isLegacyReleaseCard(await io.readNotification(it.uid, `${tmdbId}-release`))
            : false;
          const action = releaseAction(notifiedDate, dateToFire, hasLegacyCard);
          if (action === 'skip') return;                 // marker already covers this date
          if (action === 'seed') {
            // Pre-BIN-464 code already notified this user via the legacy inbox
            // card. Seed the per-user marker to this date WITHOUT re-pushing, so
            // the BIN-464 cutover never double-fires "släpps idag". Bias: a stale,
            // never-cleared card for an OLD release could seed-suppress a genuine
            // new re-release once — accepted as the "never double-push" tradeoff.
            await io.writeReleaseMarker(tmdbId, it.uid, dateToFire);
            seeded += 1;
            return;
          }
          const u = userDataOf(await io.readUserDoc(it.uid));
          if (!u) return;                                // user-doc missing → nothing to write/send
          const filmTitle = it.title?.trim() || 'En film du bevakar';
          // Inbox card — written for every bevakad owner regardless of pushEnabled,
          // mirroring episodeNotify/weeklyDigest: the in-app card rides the feature
          // opt-in (the Bevaka-släpp tap), and ONLY the FCM push is gated on
          // pushEnabled (enforced inside sendPushToUser). kind 'digital_release' is
          // tmdbId-shaped like episode_release; the client renders it. `viaMarker`
          // stamps this card as MARKER-ERA so the BIN-472 legacy guard never
          // mistakes it for a pre-BIN-464 artifact and seed-suppresses a genuine
          // re-arm once the 30-day marker has been reaped (see isLegacyReleaseCard).
          await io.writeNotification(it.uid, `${tmdbId}-release`, {
            tmdbId, mediaType: 'movie', title: filmTitle, kind: 'digital_release',
            viaMarker: true, read: false,
          });
          await io.sendPush(it.uid, {
            // "finns digitalt" not "går att streama": TMDB type-4 (digital) is the
            // digital-availability date, which can be rent/buy (TVOD), not always
            // flatrate streaming — the film page shows the exact SE offer.
            title: 'Släpps idag',
            body: `${filmTitle} finns digitalt i Sverige idag`,
            actionUrl: `/movie/${tmdbId}/`,
            tag: `release-${tmdbId}`,
          }, { pushEnabled: u.settings.pushEnabled });
          notified += 1;
          // Advance the marker AFTER the attempt (like availableNotify's marker):
          // even if the push failed we won't re-spam this user for this date; the
          // grace window + next-run retry covers a mid-day bevakning of a new date.
          await io.writeReleaseMarker(tmdbId, it.uid, dateToFire);
        } catch (err) {
          io.log.error(`releaseNotify: notify ${it.uid} for title ${tmdbId} failed`, err);
        }
      }));
    } catch (err) {
      io.log.error(`releaseNotify: title ${tmdbId} failed`, err);
    }
  }
  return { skip, notified, seeded };
}

/**
 * The whole daily job: scan, release phase, availability phase, summary.
 *
 * The two phases run STRICTLY IN SEQUENCE and that ordering is the dedup itself
 * (#13's condition 3): phase 2 reads `releaseSkip`, so if phase 1 were still
 * running, an owner it had not yet claimed would receive BOTH "släpps idag" and
 * "finns nu på X" for the same film on the same day. Do not turn this await into
 * a `Promise.all`.
 *
 * A watchlist scan that throws aborts the run (there is nothing to iterate); a
 * release phase that throws does NOT block availability, and one title's failure
 * does not stop its siblings.
 */
export async function runAvailableNotify(io: NotifyIo): Promise<NotifySummary> {
  let titles: WatchlistTitleLite[] = [];
  try { titles = await readWatchlistTitles(io); }
  catch (err) {
    io.log.error('availableNotify: watchlist scan failed', err);
    // All zeros, which is byte-identical to a genuinely empty watchlist. Its
    // retentionCleanup sibling spends −1 sentinels to keep those two apart; here
    // the only discriminator is that the `availableNotify done` line never
    // appears — true today because nothing in the tree consumes this summary. Any
    // future freshness alarm must key on the ERROR log or grow a sentinel first;
    // reading a zero here as "nothing to do" would be wrong.
    return { watchlistDocs: 0, uniqueTitles: 0, notified: 0, releaseOwned: 0, releaseNotified: 0, releaseSeeded: 0 };
  }

  // Phase 1: release-day pushes. A failure here must not block availability.
  const now = io.now();
  const today = stockholmDateString(now);
  let release: ReleasePhaseResult = { skip: new Set<string>(), notified: 0, seeded: 0 };
  try { release = await runReleasePhase(io, titles, today, now.getTime()); }
  catch (err) { io.log.error('releaseNotify phase failed', err); }

  // Phase 2: availability transitions, skipping release-owned (uid,tmdbId).
  // Grouped by (mediaType, tmdbId) via availableStateDocId (BIN-523) — TMDB
  // movie and TV ids are independent namespaces, so bare-tmdbId grouping
  // collapsed movie N + TV N into one title with an arbitrary mediaType.
  const byTitle = new Map<string, WatchlistTitleLite[]>();
  for (const it of titles) {
    const key = availableStateDocId(it.mediaType, it.tmdbId);
    const arr = byTitle.get(key); if (arr) arr.push(it); else byTitle.set(key, [it]);
  }
  let totalNotified = 0;
  for (const [stateId, items] of byTitle) {
    try { totalNotified += await processTitle(io, stateId, items, release.skip); }
    catch (err) { io.log.error(`availableNotify: title ${stateId} failed`, err); }
  }

  const summary: NotifySummary = {
    watchlistDocs: titles.length,
    uniqueTitles: byTitle.size,
    notified: totalNotified,
    releaseOwned: release.skip.size,
    releaseNotified: release.notified,
    releaseSeeded: release.seeded,
  };
  io.log.info('availableNotify done', summary);
  return summary;
}
