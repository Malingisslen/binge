'use client';

interface SeasonRowProps {
  name: string;
  episodeCount: number;
  watchedCount: number;
  onMarkWatched: () => void;
  onContinue: () => void;
}

export default function SeasonRow({ name, episodeCount, watchedCount, onMarkWatched, onContinue }: SeasonRowProps) {
  const pct = episodeCount > 0 ? (watchedCount / episodeCount) * 100 : 0;
  const isDone = watchedCount >= episodeCount && episodeCount > 0;

  return (
    <div className="flex items-center justify-between py-[5px] border-b border-[#e8e4dc] last:border-b-0 text-sm">
      <div className="font-semibold text-text-secondary">
        {name} <span className="font-normal text-text-muted text-xs">({episodeCount} avs)</span>
      </div>
      <div className="flex items-center gap-[5px] flex-1 max-w-[180px] mx-4">
        <div className="flex-1 h-[3px] bg-[#e5e0d8] rounded-[1px] overflow-hidden">
          <div className="h-full bg-accent rounded-[1px]" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xxs text-[#bbb]">{watchedCount}/{episodeCount}</span>
      </div>
      {isDone ? (
        <button
          onClick={onMarkWatched}
          className="px-[10px] py-[2px] rounded-sm text-xxs font-semibold border-none cursor-pointer bg-season-done text-white"
        >
          Sedd
        </button>
      ) : (
        <button
          onClick={onContinue}
          className="px-[10px] py-[2px] rounded-sm text-xxs font-semibold border-none cursor-pointer bg-accent text-white"
        >
          Fortsätt
        </button>
      )}
    </div>
  );
}
