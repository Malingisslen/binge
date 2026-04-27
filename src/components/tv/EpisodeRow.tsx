'use client';

import { useState } from 'react';
import { Lock } from 'lucide-react';
import type { TMDBEpisode } from '@/types';
import { stillUrl } from '@/lib/tmdb/client';

interface EpisodeRowProps {
  episode: TMDBEpisode;
  watched: boolean;
  onToggle: (watched: boolean) => void;
  onMarkUpTo?: () => void;
  // Spoiler-skydd-flagga (Fas 2b). Sätts när användaren kommit hit från
  // grupp-watchlist (?fromGroup) och avsnittet ligger ovanför gruppens
  // minsta-position. Maskar titel, still-bild, synopsis och air-date —
  // klick på kortet togglar lokal "revealed"-state som visar allt.
  spoilerMasked?: boolean;
}

export default function EpisodeRow({
  episode, watched, onToggle, onMarkUpTo, spoilerMasked,
}: EpisodeRowProps) {
  const [revealed, setRevealed] = useState(false);
  const still = stillUrl(episode.still_path, 'w185');
  // Effektiv mask = explicit flagga AND inte avslöjad lokalt.
  const masked = !!spoilerMasked && !revealed;

  if (masked) {
    return (
      <div
        className="flex items-center gap-2 py-[5px] border-b border-border-table last:border-b-0 cursor-pointer hover:bg-[#ede9e0]"
        onClick={() => setRevealed(true)}
        title="Klicka för att avslöja — gruppen har inte sett detta avsnitt än"
      >
        <input
          type="checkbox"
          checked={watched}
          onChange={e => { e.stopPropagation(); onToggle(e.target.checked); }}
          onClick={e => e.stopPropagation()}
          className="shrink-0 accent-accent w-[14px] h-[14px] cursor-pointer"
        />
        <div className="w-[60px] h-[34px] rounded-sm bg-[#ddd8d0] shrink-0 flex items-center justify-center">
          <Lock size={11} className="text-text-muted opacity-40" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-base font-semibold text-text-muted">
            {episode.episode_number}. <span className="italic">Avsnitt {episode.episode_number}</span>
          </div>
          <div className="text-xs text-text-muted/70">
            Dolt — gruppen har inte sett detta avsnitt än. <span className="text-accent">Visa ändå</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 py-[5px] border-b border-border-table last:border-b-0">
      <input
        type="checkbox"
        checked={watched}
        onChange={e => onToggle(e.target.checked)}
        className="shrink-0 accent-accent w-[14px] h-[14px] cursor-pointer"
      />
      {still ? (
        <img src={still} alt="" className="w-[60px] h-[34px] rounded-sm object-cover shrink-0" loading="lazy" decoding="async" width={60} height={34} />
      ) : (
        <div className="w-[60px] h-[34px] rounded-sm bg-[#ddd8d0] shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-base font-semibold truncate">
          {episode.episode_number}. {episode.name}
        </div>
        <div className="text-xs text-text-muted">
          {episode.air_date ?? '—'}
          {episode.runtime ? ` · ${episode.runtime} min` : ''}
          {onMarkUpTo && !watched && (
            <button
              onClick={e => { e.stopPropagation(); onMarkUpTo(); }}
              className="text-xxs text-accent cursor-pointer bg-transparent border-none p-0 ml-1 hover:underline font-[inherit]"
            >
              Markera hit
            </button>
          )}
        </div>
        {episode.overview && (
          <div className="text-xs text-text-muted mt-[2px] line-clamp-2">{episode.overview}</div>
        )}
      </div>
    </div>
  );
}
