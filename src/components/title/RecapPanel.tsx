'use client';

import { useState, type ReactNode } from 'react';
import { History, ChevronDown, ChevronUp } from 'lucide-react';
import { useRecap, useSeasonRecaps } from '@/hooks/useRecap';
import { validateRecapText } from '@/lib/recaps/sanitize';
import { missingEpisodeCount } from '@/lib/recaps/coverage';
import { priorSeasonNumbers, type EpisodeRef, type SeasonEpisodes } from '@/lib/recaps/boundary';
import type { RecapSource } from '@/lib/recaps/types';

// BIN-185 — "Påminn mig var jag slutade". Shows ONLY when a cached recap exists for the user's
// spoiler-safe boundary (the contiguous frontier, computed by the parent from episodeProgress +
// the show inventory — passed in, so this doesn't open a second progress listener). The recap
// text is rendered as a plain-text child (React auto-escapes; never dangerouslySetInnerHTML) —
// the primary control against poisoned world-editable source text.
// Licensing/source decision: docs/org/adr/0011-bin185-recap-cc-by-sa.md
//
// Layout: a "du är här" TIMELINE. The user's boundary is the saffron always-open node at the
// TOP (its story-so-far is the primary payload); prior completed seasons that HAVE a summary
// trail BELOW it as individually-collapsible nodes, most-recent first. Boundary-on-top is load-
// bearing: prior-season docs resolve async, and anything appended below can't shift the text
// above — so the story-so-far the user is reading never reflows as season nodes pop in. This
// replaced a single "Visa tidigare säsonger" toggle that expanded ALL seasons at once. Season
// docs are fetched when the panel opens (the deliberate expand — never on the default show view;
// DBA "no default-view reads" rule) and only seasons with a valid, attributed recap become
// nodes, so a partially-seeded show never shows dead-end "no summary" rows.

/** Only ever emit an href for an http(s) URL — defense-in-depth so a malformed source URL
 * (e.g. a `javascript:` scheme React would not block) can never become a live link. */
function safeHref(url: string): string | null {
  return /^https?:\/\//i.test(url) ? url : null;
}

function RecapSourceCredit({ sources }: { sources: RecapSource[] }) {
  const label = sources.length === 1 ? 'Källa' : 'Källor';
  return (
    <div className="text-[11px] text-ink-3 mt-2">
      {label}:{' '}
      {sources.map((s, i) => {
        const href = safeHref(s.url);
        return (
          <span key={s.url}>
            {i > 0 && (i === sources.length - 1 ? ' och ' : ', ')}
            {href
              ? <a href={href} target="_blank" rel="noopener noreferrer" className="underline">{s.name}</a>
              : <span>{s.name}</span>}
          </span>
        );
      })}{' '}
      (
      <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer" className="underline">
        CC BY-SA 4.0
      </a>
      ), bearbetad
    </div>
  );
}

/** The recap prose with its mandated disclosures — the AI-generated label (EU AI Act Art. 50),
 * the accuracy caveat, and the CC BY-SA source credit (ADR-0011). One component so all three
 * render sites (boundary node, full-season expand, each prior-season node) stay identical: a
 * legal reword of the label/caveat happens in exactly one place. */
function DisclosedRecapProse({ text, sources }: { text: string; sources: RecapSource[] }) {
  return (
    <>
      <div className="text-[11px] text-ink-2 font-medium">AI-genererad sammanfattning</div>
      <p className="text-[14px] text-ink mt-1 whitespace-pre-line">{text}</p>
      <div className="text-[11px] text-ink-3 mt-2">Kan innehålla mindre felaktigheter.</div>
      <RecapSourceCredit sources={sources} />
    </>
  );
}

/** One row on the timeline spine: a dot rail (with a connector line to the next node, unless
 * this is the last node) plus the node's content. */
function NodeRow({ dot, last, children }: { dot: ReactNode; last?: boolean; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        {dot}
        {!last && <div className="w-px flex-1 bg-rule mt-1.5" />}
      </div>
      <div className={last ? 'flex-1' : 'flex-1 pb-3'}>{children}</div>
    </li>
  );
}

const priorDot = <div className="mt-1 h-3 w-3 shrink-0 rounded-full border-2 border-rule bg-surface" />;
const hereDot = (
  <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-acc-soft">
    <div className="h-2 w-2 rounded-full bg-acc" />
  </div>
);

export default function RecapPanel({
  tmdbId,
  boundary,
  inventory,
}: {
  tmdbId: number;
  boundary: EpisodeRef | null;
  inventory: SeasonEpisodes;
}) {
  const { recap, coveredBoundary, seasonOnlySeasons } = useRecap(tmdbId, boundary);
  const [open, setOpen] = useState(false);
  const [openFull, setOpenFull] = useState(false);
  const [expandedSeasons, setExpandedSeasons] = useState<number[]>([]);

  // Prior COMPLETED seasons — the UNION of two independent sources, not a choice between them
  // (code review, 2026-07-20: a show can legitimately have BOTH some per-episode-covered seasons
  // AND a later season-only-sourced one — e.g. a long-running series whose Wikipedia detail
  // trails off partway through, a pattern RUNBOOK.md itself documents as common. Treating the two
  // as mutually exclusive silently dropped the season-only season whenever ANY per-episode
  // boundary recap also existed for the show):
  //  1. From the recap's actual COVERED boundary (never the user's raw boundary — on a fallback
  //     hit those can differ, and a season node must only ever be offered for a season the cached
  //     STORY itself has fully passed; locked by an existing test — do not change this half).
  //  2. From the user's REAL watched boundary, intersected with `seasonOnlySeasons` (from the
  //     index, so no read is wasted probing seasons that were never season-only-sourced) — covers
  //     any season-only season the first source can't see, because `coveredBoundary` only ever
  //     reflects PER-EPISODE coverage. Reuses `priorSeasonNumbers`'s existing guarantee (every
  //     season it returns is strictly BEFORE the user's current one, and `boundary` is already
  //     the CONTIGUOUS watched frontier per `contiguousWatchedBoundary`, so every one of those
  //     seasons is provably fully watched) rather than inventing a new derivation — fail-closed
  //     by construction: `boundary` is only ever null when the user hasn't started the show,
  //     which correctly yields no seasons from this source.
  const priorSeasons = [...new Set([
    ...(coveredBoundary ? priorSeasonNumbers(coveredBoundary) : []),
    ...(boundary ? priorSeasonNumbers(boundary).filter((s) => seasonOnlySeasons.includes(s)) : []),
  ])].sort((a, b) => a - b);

  // Fetch the prior-season docs when the panel is OPEN (the deliberate expand — never on the
  // default show view). Only seasons with a valid, attributed, plain-text recap become nodes,
  // so a partially-seeded show shows no dead-end "no summary yet" rows and an errored/timed-out
  // read simply omits that season rather than spinning forever.
  const seasonRecaps = useSeasonRecaps(tmdbId, priorSeasons, open);
  const loadedSeasons = seasonRecaps.filter(
    (s): s is { season: number; recap: NonNullable<(typeof seasonRecaps)[number]['recap']>; isLoading: boolean } =>
      s.recap != null && s.recap.sources.length > 0 && validateRecapText(s.recap.text).ok,
  );

  // The "du är här" node needs a boundary, a cached per-episode recap, its CC BY-SA attribution
  // (mandatory per ADR 0011 — never show unattributed derived text), and text that passes the
  // plain-text guard on read (defense-in-depth; the batch validates on write, we re-check here).
  // A season-only-sourced show has none of this — `coveredBoundary`/`recap` are always null for
  // it (no boundary doc was ever written) — but MAY still have prior-season nodes above, so the
  // panel only bails out entirely when there's neither.
  //
  // CRITICAL: this gate (and therefore whether the toggle BUTTON itself renders at all) must key
  // on `priorSeasons`, NOT `loadedSeasons`. `loadedSeasons` comes from `useSeasonRecaps`, which is
  // only ENABLED once the panel is already open (`open` starts `false`) — for a season-only show,
  // that's always `[]` before the user has ever seen a button to click, so gating on it here
  // would make the button permanently unreachable (code review, 2026-07-20). `priorSeasons` is
  // safe to gate on before open: the boundary-derived half comes from a per-episode boundary
  // doc's presence (unchanged, existing behavior), and the season-only half comes from
  // `seasonOnlySeasons`, part of the index doc that's ALWAYS fetched regardless of `open`.
  const hasBoundaryRecap = Boolean(
    boundary && recap && coveredBoundary && recap.sources.length > 0 && validateRecapText(recap.text).ok,
  );
  if (!hasBoundaryRecap && priorSeasons.length === 0) return null;

  // Fallback gap: the recap covers an EARLIER boundary (never later — spoiler-safe by
  // construction). Tell the user honestly how many of their watched episodes it misses.
  // Only meaningful when there IS a "här" node — a season-only show has no boundary recap to
  // compare against at all.
  const missing = hasBoundaryRecap ? missingEpisodeCount(inventory, coveredBoundary!, boundary!) : 0;

  // textFull is absent on older (schemaVersion 1) or not-yet-regenerated recaps — degrade
  // silently, never show an empty disclosure.
  const fullText = hasBoundaryRecap && recap!.textFull && validateRecapText(recap!.textFull).ok ? recap!.textFull : null;

  const toggleSeason = (s: number) =>
    setExpandedSeasons((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  // The user's boundary node — always open, so its AI disclosure stays visible for the whole
  // panel (EU AI Act Art. 50) and its story-so-far is the primary content. null on a season-only
  // show with no per-episode boundary recap — the timeline then opens directly on prior seasons.
  const hereContent = hasBoundaryRecap ? (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold text-ink">
          Säsong {boundary!.season}, avsnitt {boundary!.episode}
        </span>
        <span className="rounded bg-acc-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-acc-deep">
          Du är här
        </span>
      </div>
      {missing > 0 && (
        <div className="text-[12px] text-ink-2 mt-1">
          Sammanfattningen täcker till och med S{coveredBoundary!.season}E{coveredBoundary!.episode} —
          {' '}informationen från {missing === 1 ? 'det senaste avsnittet' : `de ${missing} senaste avsnitten`} du sett saknas.
        </div>
      )}
      <div className="mt-1.5">
        <DisclosedRecapProse text={recap!.text} sources={recap!.sources} />
      </div>

      {fullText && (
        <div className="mt-3 border-t border-rule-2 pt-2">
          <button
            type="button"
            className="flex w-full items-center gap-2 text-[12px] font-medium text-ink-2 hover:text-ink"
            onClick={() => setOpenFull((o) => !o)}
            aria-expanded={openFull}
          >
            <span>Visa hela säsongen hittills</span>
            <span className="ml-auto text-ink-3">
              {openFull ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </span>
          </button>
          {openFull && (
            <div className="mt-2">
              <DisclosedRecapProse text={fullText} sources={recap!.sources} />
            </div>
          )}
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className="mt-3 rounded-md border border-rule bg-surface overflow-hidden">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2.5 text-[13px] font-medium text-ink hover:bg-bg-2"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <History size={15} className="text-ink-3 shrink-0" />
        <span>Påminn mig var jag slutade</span>
        <span className="ml-auto text-ink-3">
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-2 border-t border-rule">
          {/* Always a timeline — the boundary "du är här" node renders FIRST with its saffron dot
              (identical whether the show has prior seasons, none, or their docs haven't resolved
              yet), and prior-season nodes append BELOW it as they load. Boundary-first + a single
              stable container means async-loading nodes can never shift the story-so-far above
              them, and there is no structural swap between the loading and loaded states. No
              loading spinner by design: a season read that errors keeps isLoading sticky-true, so
              a spinner could hang forever on the all-error (offline) path — an offline user still
              gets their story-so-far, just without the prior-season nodes.
              A season-only-sourced show (no `hereContent` at all — see `hasBoundaryRecap` above)
              has no "här" node to anchor on; the timeline then opens directly on prior seasons,
              which is why `last` below is computed from array position rather than assuming a
              "här" node always occupies index 0. */}
          <ol className="mt-1">
            {hereContent && (
              <NodeRow dot={hereDot} last={loadedSeasons.length === 0}>
                {hereContent}
              </NodeRow>
            )}
            {[...loadedSeasons].reverse().map(({ season, recap: seasonRecap }, i, arr) => {
              const isOpen = expandedSeasons.includes(season);
              return (
                <NodeRow key={season} dot={priorDot} last={i === arr.length - 1}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 text-[13px] font-medium text-ink hover:text-ink-2"
                    onClick={() => toggleSeason(season)}
                    aria-expanded={isOpen}
                  >
                    <span>Säsong {season}</span>
                    <span className="ml-auto text-ink-3">
                      {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="mt-1.5">
                      <DisclosedRecapProse text={seasonRecap.text} sources={seasonRecap.sources} />
                    </div>
                  )}
                </NodeRow>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
