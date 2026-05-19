'use client';

import Link from 'next/link';
import { stillUrl, backdropUrl } from '@/lib/tmdb/client';
import { toneForGenreIds } from '@/lib/duotone';
import { useEpisodeProgressWithSync } from '@/hooks/useEpisodeProgressWithSync';
import type { CalendarEntry } from '@/hooks/useCalendar';

// Direction H calendar event card. Vertical layout: 16:9 duotone still on
// top with a tiny badge (premiär / ny ikväll / säsongsfinal) overlapping
// top-left, body below with title (line-clamped 2), meta (S/E · channel),
// 2-line synopsis. Today's episode wears a 3px plum inset rule.

interface Props {
  entry: CalendarEntry;
  isTonight?: boolean;
}

function pickBadge(entry: CalendarEntry, isTonight: boolean): string | null {
  if (isTonight) return 'ny ikväll';
  if (entry.isPremiere) return entry.season === 1 ? 'premiär' : 'ny säsong';
  if (entry.isFinale) return 'säsongsfinal';
  return null;
}

export default function EventCard({ entry, isTonight = false }: Props) {
  const { isWatched, markEpisodeWatched } = useEpisodeProgressWithSync(entry.tmdbId);
  const watched = isWatched(entry.season, entry.episode);
  const tone = toneForGenreIds(entry.genreIds);

  // Still path preferred (episode-specific), backdrop as fallback. Both go
  // through the same duotone treatment.
  const still = stillUrl(entry.backdropPath, 'w500')
    ?? backdropUrl(entry.backdropPath, 'w780');

  const badge = pickBadge(entry, isTonight);

  const handleToggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await markEpisodeWatched(entry.season, entry.episode, !watched);
  };

  return (
    <Link
      href={`/tv/${entry.tmdbId}/`}
      className={`ev${isTonight ? ' is-tonight' : ''}${watched ? ' is-watched' : ''}`}
      aria-label={`${entry.title} · ${entry.episodeCode}`}
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
          {entry.episodeCode}
          {entry.provider ? <> · <span className="ch">{entry.provider}</span></> : null}
        </div>
        {entry.episodeName && (
          <div className="syn">
            <strong style={{ color: 'var(--ink)', fontWeight: 500 }}>{entry.episodeName}</strong>
            {entry.episodeOverview ? ` — ${entry.episodeOverview}` : ''}
          </div>
        )}
        {!entry.episodeName && entry.episodeOverview && (
          <div className="syn">{entry.episodeOverview}</div>
        )}
        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center' }}>
          <button
            type="button"
            onClick={handleToggle}
            className={`ev-toggle${watched ? ' is-on' : ''}`}
            aria-pressed={watched}
            aria-label={watched ? 'Markera osedd' : 'Markera sedd'}
            title={watched ? 'Markera osedd' : 'Markera sedd'}
          />
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--ink-3)', letterSpacing: 0.04 }}>
            {watched ? 'sett' : 'markera sedd'}
          </span>
        </div>
      </div>
    </Link>
  );
}
