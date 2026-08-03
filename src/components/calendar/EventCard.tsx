'use client';

import Link from 'next/link';
import { stillUrl, backdropUrl } from '@/lib/tmdb/client';
import { toneForGenreIds } from '@/lib/duotone';
import { useEpisodeProgressWithSync } from '@/hooks/useEpisodeProgressWithSync';
import { entryHref, entryBadge, entryMetaLine, canMarkWatched } from '@/lib/calendar/entry';
import type { CalendarEntry } from '@/hooks/useCalendar';

// Direction H calendar event card. Vertical layout: 16:9 duotone still on
// top with a tiny badge (premiär / ny ikväll / säsongsfinal / digital release)
// overlapping top-left, body below with title (line-clamped 2), meta line, and
// a 2-line synopsis. Today's event wears a 3px plum inset rule.
//
// Renders two event kinds: episodes of shows you follow ('mina', incl. ej
// påbörjade — all with a "markera sedd"-toggle) and Swedish digital movie
// releases ("vill se"-tag, no toggle).

interface Props {
  entry: CalendarEntry;
  isTonight?: boolean;
}

export default function EventCard({ entry, isTonight = false }: Props) {
  // Hooken anropas alltid (ovillkorligt) — den är episode-progress men ofarlig
  // för film. `watched` beräknas bara för avsnitt i serier du tittar på.
  const { isWatched, markEpisodeWatched } = useEpisodeProgressWithSync(entry.tmdbId);
  const showToggle = canMarkWatched(entry);
  const watched = entry.kind === 'episode' && showToggle
    ? isWatched(entry.season, entry.episode)
    : false;

  const tone = toneForGenreIds(entry.genreIds);
  const badge = entryBadge(entry, isTonight);
  const href = entryHref(entry);
  const metaLine = entryMetaLine(entry);

  // Still path preferred (episode-specific), backdrop as fallback. Both go
  // through the same duotone treatment.
  const still = stillUrl(entry.backdropPath, 'w300')
    ?? backdropUrl(entry.backdropPath, 'w300');

  // Synopsis: episodes carry an episode name + overview; movies just an
  // overview. Narrow on `kind` to read the right fields.
  const headline = entry.kind === 'episode' ? entry.episodeName : undefined;
  const overview = entry.kind === 'episode' ? entry.episodeOverview : entry.overview;

  const ariaLabel = entry.kind === 'movie'
    ? `${entry.title} · digital release`
    : `${entry.title} · ${entry.episodeCode}`;

  const handleToggle = async () => {
    if (entry.kind !== 'episode') return;
    await markEpisodeWatched(entry.season, entry.episode, !watched);
  };

  // A11y/HTML validity: the "markera sedd"-toggle is a SIBLING of the Link, never
  // nested inside it — interactive content inside an <a> is invalid and made the
  // toggle need a preventDefault/stopPropagation workaround to stop the card from
  // navigating. Outside the anchor, a click on the button simply isn't a click on
  // the link, so no event surgery is needed.
  //
  // The Link keeps the card's whole clickable surface (still + text) and carries
  // the flex-column layout `.ev` used to own; the footer row below re-creates the
  // exact spacing the toggle had while it lived inside `.body` (8px above it,
  // 12px under it), so nothing moves on screen.
  //
  // ONLY the toggle moves out. A movie card's "vill se" is a plain span with
  // nothing focusable in it, so hoisting it too would cost ~27px of navigable
  // card surface (and flip that strip's cursor from pointer to default) for no
  // a11y gain — it stays inside the anchor, with the spacing it always had.
  const footerStyle = { padding: '0 12px 12px', cursor: 'default' } as const;
  const footerLabelStyle = { fontSize: 10.5, color: 'var(--ink-3)', letterSpacing: 0.04 } as const;

  return (
    <div className={`ev${isTonight ? ' is-tonight' : ''}${watched ? ' is-watched' : ''}`}>
      {/* The negative focus-ring offset is load-bearing, not decoration: the card root clips
          its children (`overflow: hidden`, which is what rounds the still's top corners),
          and the global `:focus-visible` ring in globals.css is drawn 2px OUTSIDE the
          border box. Now that the focusable element is this inner anchor rather than the
          card root, an outward ring would be clipped away on three sides and survive as a
          stray line over the footer. Drawing the same ring inward keeps it whole. */}
      <Link
        href={href}
        className="flex flex-1 flex-col no-underline text-inherit focus-visible:[outline-offset:-2px]"
        aria-label={ariaLabel}
      >
        <div className={`px duo-${tone}`}>
          {still ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={still} alt="" loading="lazy" decoding="async" width={500} height={281} />
          ) : null}
          {badge && <span className="badge">{badge}</span>}
        </div>
        <div className="body" style={showToggle ? { paddingBottom: 8 } : undefined}>
          <div className="ttl">{entry.title}</div>
          <div className="meta">
            {metaLine}
            {entry.provider ? <> · <span className="ch">{entry.provider}</span></> : null}
          </div>
          {headline && (
            <div className="syn">
              <strong style={{ color: 'var(--ink)', fontWeight: 500 }}>{headline}</strong>
              {overview ? ` — ${overview}` : ''}
            </div>
          )}
          {!headline && overview && (
            <div className="syn">{overview}</div>
          )}
          {!showToggle && (
            <div style={{ marginTop: 4 }}>
              <span style={footerLabelStyle}>vill se</span>
            </div>
          )}
        </div>
      </Link>
      {showToggle && (
        <div style={{ ...footerStyle, display: 'flex', alignItems: 'center' }}>
          {/* The text is INSIDE the button, not beside it. While the toggle lived in the
              anchor its label was a navigation target; as a sibling span it would be a
              dead zone next to a 14px hit area. As button content it labels the control
              (so no aria-label — it would break "label in name" in the watched state) and
              enlarges the tap target. The square is now a decorative span; `.ev-toggle`'s
              own styles are unchanged, and `block` is belt-and-braces — a flex item is
              blockified anyway, so it only matters if the button stops being flex. */}
          <button
            type="button"
            onClick={handleToggle}
            aria-pressed={watched}
            className="flex items-center"
            style={footerLabelStyle}
          >
            <span className={`ev-toggle block${watched ? ' is-on' : ''}`} aria-hidden="true" />
            {watched ? 'sett' : 'markera sedd'}
          </button>
        </div>
      )}
    </div>
  );
}
