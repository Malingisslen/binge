'use client';

import { useState } from 'react';
import { Lock } from 'lucide-react';
import type { TMDBEpisode } from '@/types';
import { stillUrl } from '@/lib/tmdb/client';
import { todayIso, shortSwedishWeekday } from '@/lib/utils';

interface EpisodeRowProps {
  episode: TMDBEpisode;
  seasonNumber: number;
  watched: boolean;
  onToggle: (watched: boolean) => void;
  onMarkUpTo?: () => void;
  // Spoiler-skydd-flagga (Fas 2b). Sätts när användaren kommit hit från
  // grupp-watchlist (?fromGroup) och avsnittet ligger ovanför gruppens
  // minsta-position. Maskar titel, still-bild, synopsis och air-date —
  // klick på kortet togglar lokal "revealed"-state som visar allt.
  spoilerMasked?: boolean;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatUnairedRunt(iso: string): string {
  const wd = shortSwedishWeekday(iso);
  const d = new Date(iso + 'T00:00:00');
  return `${wd} ${d.getDate()}/${d.getMonth() + 1}`;
}

export default function EpisodeRow({
  episode, seasonNumber, watched, onToggle, onMarkUpTo, spoilerMasked,
}: EpisodeRowProps) {
  const [revealed, setRevealed] = useState(false);
  const still = stillUrl(episode.still_path, 'w185');
  const masked = !!spoilerMasked && !revealed;

  const today = todayIso();
  const airDate = episode.air_date ?? null;
  const isToday = !!airDate && airDate === today;
  const isUnaired = !!airDate && airDate > today;

  const code = `S${seasonNumber}E${pad2(episode.episode_number)}`;
  const runt = isUnaired && airDate
    ? formatUnairedRunt(airDate)
    : episode.runtime
      ? `${episode.runtime} min`
      : '';

  if (masked) {
    return (
      <div
        className="ep masked"
        onClick={() => setRevealed(true)}
        title="Klicka för att avslöja — gruppen har inte sett detta avsnitt än"
      >
        <div className="still">
          <Lock size={14} className="text-ink-3 opacity-40" />
        </div>
        <div className="code">{code}</div>
        <div>
          <div className="ttl">Avsnitt {episode.episode_number}</div>
          <div className="syn">
            Dolt — gruppen har inte sett detta avsnitt än. <span className="text-acc-deep">Visa ändå</span>
          </div>
        </div>
        <div className="runt"></div>
        <div></div>
      </div>
    );
  }

  const stateClass = isToday ? ' tonight' : isUnaired ? ' unaired' : '';

  return (
    <div className={`ep${stateClass}`}>
      <div className="still">
        {still ? (
          <img src={still} alt="" loading="lazy" decoding="async" width={120} height={68} />
        ) : null}
      </div>
      <div className="code">{code}</div>
      <div>
        <div className="ttl">{episode.name}</div>
        {episode.overview && <div className="syn">{episode.overview}</div>}
        {onMarkUpTo && !watched && !isUnaired && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onMarkUpTo(); }}
            className="mark-up-to"
          >
            Markera hit
          </button>
        )}
      </div>
      <div className="runt">{runt}</div>
      {isToday ? (
        <div>
          <span className="chip acc">nu</span>
        </div>
      ) : (
        <label className="check">
          <input
            type="checkbox"
            checked={watched}
            onChange={e => onToggle(e.target.checked)}
            aria-label={watched ? 'Markera som osedd' : 'Markera som sedd'}
          />
          {watched ? '✓' : ''}
        </label>
      )}
    </div>
  );
}
