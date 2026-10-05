'use client';

import { memo, useState } from 'react';
import { Lock, Check } from 'lucide-react';
import type { TMDBEpisode } from '@/types';
import { stillUrl } from '@/lib/tmdb/client';
import { todayIso, shortSwedishWeekday } from '@/lib/utils';
import EpisodeReactions from './EpisodeReactions';

interface EpisodeRowProps {
  episode: TMDBEpisode;
  seasonNumber: number;
  tmdbId: number;
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

// T7: memo — säsongspaneler renderar upp till ~30+ rader och varje
// episodeProgress-onSnapshot re-renderar hela detaljsidan. Med memo hoppar
// orörda rader över re-rendern (kräver stabila callbacks från föräldern —
// se PanelEpisodeRow i SeasonEpisodePanel).
function EpisodeRow({
  episode, seasonNumber, tmdbId, watched, onToggle, onMarkUpTo, spoilerMasked,
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
    // A real button (A11Y-2): the reveal used to be a click-only <div>, so keyboard
    // and switch users could never open a masked episode. The spans keep the
    // button's content phrasing-only; `.ep` lays them out exactly like the
    // unmasked row's divs.
    return (
      <button
        type="button"
        className="ep masked"
        onClick={() => setRevealed(true)}
        aria-label={`${code}, dolt avsnitt. Visa ändå`}
      >
        <span className="still">
          <Lock size={14} className="text-ink-3 opacity-40" />
        </span>
        <span className="code">{code}</span>
        <span className="main">
          <span className="ttl">Avsnitt {episode.episode_number}</span>
          <span className="syn">
            Dolt, gruppen har inte sett det här avsnittet än. <span className="text-acc-deep">Visa ändå</span>
          </span>
        </span>
        <span className="runt"></span>
        <span className="end"></span>
      </button>
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
      <div className="main">
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
        {/* BIN-95: per-episode reactions, spoiler-gated on own progress.
            Only rendered for aired episodes. */}
        {!isUnaired && (
          <EpisodeReactions
            tmdbId={tmdbId}
            season={seasonNumber}
            episode={episode.episode_number}
            watched={watched}
          />
        )}
      </div>
      <div className="runt">{runt}</div>
      {isToday ? (
        <div className="end">
          <span className="chip acc">nu</span>
        </div>
      ) : (
        <label className="check end">
          <input
            type="checkbox"
            checked={watched}
            onChange={e => onToggle(e.target.checked)}
            aria-label={watched ? 'Markera som osedd' : 'Markera som sedd'}
          />
          <span className="box" aria-hidden="true">{watched ? <Check size={12} strokeWidth={2.5} /> : null}</span>
        </label>
      )}
    </div>
  );
}

export default memo(EpisodeRow);
