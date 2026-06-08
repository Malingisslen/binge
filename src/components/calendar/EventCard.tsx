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
// Renders three event kinds: episodes of shows you watch ('mina' — with a
// "markera sedd"-toggle), episodes of shows you want to see ('vill_se' — no
// toggle, "vill se"-tag instead), and Swedish digital movie releases.

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
  const still = stillUrl(entry.backdropPath, 'w500')
    ?? backdropUrl(entry.backdropPath, 'w780');

  // Synopsis: episodes carry an episode name + overview; movies just an
  // overview. Narrow on `kind` to read the right fields.
  const headline = entry.kind === 'episode' ? entry.episodeName : undefined;
  const overview = entry.kind === 'episode' ? entry.episodeOverview : entry.overview;

  const ariaLabel = entry.kind === 'movie'
    ? `${entry.title} · digital release`
    : `${entry.title} · ${entry.episodeCode}`;

  const handleToggle = async (e: React.MouseEvent) => {
    if (entry.kind !== 'episode') return;
    e.preventDefault();
    e.stopPropagation();
    await markEpisodeWatched(entry.season, entry.episode, !watched);
  };

  return (
    <Link
      href={href}
      className={`ev${isTonight ? ' is-tonight' : ''}${watched ? ' is-watched' : ''}`}
      aria-label={ariaLabel}
    >
      <div className={`px duo-${tone}`}>
        {still ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={still} alt="" loading="lazy" decoding="async" width={500} height={281} />
        ) : null}
        {badge && <span className="badge">{badge}</span>}
      </div>
      <div className="body">
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
        {showToggle ? (
          <div style={{ marginTop: 4, display: 'flex', alignItems: 'center' }}>
            <button
              type="button"
              onClick={handleToggle}
              className={`ev-toggle${watched ? ' is-on' : ''}`}
              aria-pressed={watched}
              aria-label={watched ? 'Markera osedd' : 'Markera sedd'}
              title={watched ? 'Markera osedd' : 'Markera sedd'}
            />
            <span style={{ fontSize: 10.5, color: 'var(--ink-3)', letterSpacing: 0.04 }}>
              {watched ? 'sett' : 'markera sedd'}
            </span>
          </div>
        ) : (
          <div style={{ marginTop: 4 }}>
            <span style={{ fontSize: 10.5, color: 'var(--ink-3)', letterSpacing: 0.04 }}>
              vill se
            </span>
          </div>
        )}
      </div>
    </Link>
  );
}
