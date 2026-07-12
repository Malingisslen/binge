'use client';

import { useState } from 'react';
import { History, ChevronDown, ChevronUp } from 'lucide-react';
import { useRecap } from '@/hooks/useRecap';
import { validateRecapText } from '@/lib/recaps/sanitize';
import { missingEpisodeCount } from '@/lib/recaps/coverage';
import type { EpisodeRef, SeasonEpisodes } from '@/lib/recaps/boundary';
import type { RecapSource } from '@/lib/recaps/types';

// BIN-185 — "Påminn mig var jag slutade". Shows ONLY when a cached recap exists for the user's
// spoiler-safe boundary (the contiguous frontier, computed by the parent from episodeProgress +
// the show inventory — passed in, so this doesn't open a second progress listener). The recap
// text is rendered as a plain-text child (React auto-escapes; never dangerouslySetInnerHTML) —
// the primary control against poisoned world-editable source text. Spec:
// docs/superpowers/specs/2026-07-12-bin185-spoiler-safe-recaps-design.md

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

  // Surface nothing unless we have a boundary, a cached recap, its CC BY-SA attribution
  // (mandatory per ADR 0011 — never show unattributed derived text), and text that passes the
  // plain-text guard on read (defense-in-depth; the batch validates on write, we re-check here).
  if (!boundary || !recap || !coveredBoundary) return null;
  if (recap.sources.length === 0) return null;
  if (!validateRecapText(recap.text).ok) return null;

  // Fallback gap: the recap covers an EARLIER boundary (never later — spoiler-safe by
  // construction). Tell the user honestly how many of their watched episodes it misses.
  const missing = missingEpisodeCount(inventory, coveredBoundary, boundary);

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
        <div className="px-3 pb-3 pt-1 border-t border-rule">
          <div className="text-[13px] text-ink-2 mt-2">
            Du slutade efter S{boundary.season}E{boundary.episode}.
          </div>
          {missing > 0 && (
            <div className="text-[12px] text-ink-2 mt-1">
              Sammanfattningen täcker till och med S{coveredBoundary.season}E{coveredBoundary.episode} —
              {' '}informationen från {missing === 1 ? 'det senaste avsnittet' : `de ${missing} senaste avsnitten`} du sett saknas.
            </div>
          )}
          {/* AI disclosure ABOVE the prose (EU AI Act Art. 50 — legible secondary text). */}
          <div className="text-[11px] text-ink-2 mt-1 font-medium">AI-genererad sammanfattning</div>
          <p className="text-[14px] text-ink mt-1 whitespace-pre-line">{recap.text}</p>
          <div className="text-[11px] text-ink-3 mt-2">Kan innehålla mindre felaktigheter.</div>
          <RecapSourceCredit sources={recap.sources} />
        </div>
      )}
    </div>
  );
}
