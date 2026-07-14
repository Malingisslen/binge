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
  const { recap, coveredBoundary } = useRecap(tmdbId, boundary);
  const [open, setOpen] = useState(false);
  const [openFull, setOpenFull] = useState(false);
  const [expandedSeasons, setExpandedSeasons] = useState<number[]>([]);

  // Prior COMPLETED seasons, derived from the recap's actual covered boundary (never the user's
  // raw boundary — on a fallback hit those can differ, and a season node must only ever be
  // offered for a season the cached recap itself has fully passed). Returned ascending; rendered
  // descending below the boundary so the most recently finished season sits nearest "du är här".
  const priorSeasons = coveredBoundary ? priorSeasonNumbers(coveredBoundary) : [];

  // Fetch the prior-season docs when the panel is OPEN (the deliberate expand — never on the
  // default show view). Only seasons with a valid, attributed, plain-text recap become nodes,
  // so a partially-seeded show shows no dead-end "no summary yet" rows and an errored/timed-out
  // read simply omits that season rather than spinning forever.
  const seasonRecaps = useSeasonRecaps(tmdbId, priorSeasons, open);
  const loadedSeasons = seasonRecaps.filter(
    (s): s is { season: number; recap: NonNullable<(typeof seasonRecaps)[number]['recap']>; isLoading: boolean } =>
      s.recap != null && s.recap.sources.length > 0 && validateRecapText(s.recap.text).ok,
  );

  // Surface nothing unless we have a boundary, a cached recap, its CC BY-SA attribution
  // (mandatory per ADR 0011 — never show unattributed derived text), and text that passes the
  // plain-text guard on read (defense-in-depth; the batch validates on write, we re-check here).
  if (!boundary || !recap || !coveredBoundary) return null;
  if (recap.sources.length === 0) return null;
  if (!validateRecapText(recap.text).ok) return null;

  // Fallback gap: the recap covers an EARLIER boundary (never later — spoiler-safe by
  // construction). Tell the user honestly how many of their watched episodes it misses.
  const missing = missingEpisodeCount(inventory, coveredBoundary, boundary);

  // textFull is absent on older (schemaVersion 1) or not-yet-regenerated recaps — degrade
  // silently, never show an empty disclosure.
  const fullText = recap.textFull && validateRecapText(recap.textFull).ok ? recap.textFull : null;

  const toggleSeason = (s: number) =>
    setExpandedSeasons((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  // The user's boundary node — always open, so its AI disclosure stays visible for the whole
  // panel (EU AI Act Art. 50) and its story-so-far is the primary content.
  const hereContent = (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold text-ink">
          Säsong {boundary.season}, avsnitt {boundary.episode}
        </span>
        <span className="rounded bg-acc-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-acc-deep">
          Du är här
        </span>
      </div>
      {missing > 0 && (
        <div className="text-[12px] text-ink-2 mt-1">
          Sammanfattningen täcker till och med S{coveredBoundary.season}E{coveredBoundary.episode} —
          {' '}informationen från {missing === 1 ? 'det senaste avsnittet' : `de ${missing} senaste avsnitten`} du sett saknas.
        </div>
      )}
      <div className="mt-1.5">
        <DisclosedRecapProse text={recap.text} sources={recap.sources} />
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
              <DisclosedRecapProse text={fullText} sources={recap.sources} />
            </div>
          )}
        </div>
      )}
    </div>
  );

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
              gets their story-so-far, just without the prior-season nodes. */}
          <ol className="mt-1">
            <NodeRow dot={hereDot} last={loadedSeasons.length === 0}>
              {hereContent}
            </NodeRow>
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
