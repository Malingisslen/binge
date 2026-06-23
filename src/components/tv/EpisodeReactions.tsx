'use client';

import { useState } from 'react';
import { useEpisodeReactions, type EpisodeReaction } from '@/hooks/useEpisodeReactions';
import { LoadingView } from '@/components/ui/LoadingView';

// BIN-95: per-episode reaction thread. The whole thread is spoiler-gated on the
// viewer's own progress — if they haven't watched THIS episode, no reactions are
// loaded or shown (reactions are inherently spoilery for the episode). Within a
// watched episode, individual reactions flagged as spoilers (e.g. for LATER
// events) are blurred until clicked, mirroring the title-level review pattern.
export default function EpisodeReactions({ tmdbId, season, episode, watched }: {
  tmdbId: number; season: number; episode: number; watched: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (!watched) {
    return (
      <div className="ep-reactions-gate text-xxs text-text-muted mt-1">
        Reaktioner visas när du markerat avsnittet som sett — så undviker du spoilers.
      </div>
    );
  }
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xxs text-accent mt-1 bg-transparent border-none p-0 cursor-pointer"
      >
        Visa reaktioner
      </button>
    );
  }
  return <ReactionsThread tmdbId={tmdbId} season={season} episode={episode} onClose={() => setOpen(false)} />;
}

function ReactionsThread({ tmdbId, season, episode, onClose }: {
  tmdbId: number; season: number; episode: number; onClose: () => void;
}) {
  const { reactions, loading, addReaction, deleteReaction, currentUid } = useEpisodeReactions(tmdbId, season, episode, true);
  const [text, setText] = useState('');
  const [spoiler, setSpoiler] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    const res = await addReaction(text, spoiler);
    setBusy(false);
    if (res.ok) { setText(''); setSpoiler(false); }
    else setErr(res.error ?? 'Kunde inte spara.');
  };

  return (
    <div className="ep-reactions bg-surface border border-rule rounded-md p-2 mt-1">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xxs uppercase tracking-[0.5px] text-text-muted font-semibold">Reaktioner</span>
        <button type="button" onClick={onClose} className="text-xxs text-text-muted bg-transparent border-none cursor-pointer">Dölj</button>
      </div>

      {currentUid && (
        <div className="mb-2">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Vad tyckte du om avsnittet?"
            maxLength={2000}
            rows={2}
            className="w-full px-2 py-1 text-xs border border-rule rounded-sm bg-surface font-[inherit] resize-none outline-none"
          />
          <div className="flex items-center justify-between mt-1">
            <label className="flex items-center gap-1 text-xxs text-text-muted cursor-pointer">
              <input type="checkbox" checked={spoiler} onChange={e => setSpoiler(e.target.checked)} className="accent-acc-deep" />
              Innehåller spoiler (senare händelser)
            </label>
            <button type="button" onClick={() => void submit()} disabled={busy} className="chip">Posta</button>
          </div>
          {err && <div className="text-xxs text-danger-ink mt-1">{err}</div>}
        </div>
      )}

      {loading ? (
        <LoadingView label="Laddar reaktioner…" />
      ) : reactions.length === 0 ? (
        <div className="text-xxs text-text-muted py-1">Inga reaktioner än — bli först.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {reactions.map(r => (
            <ReactionItem key={r.id} reaction={r} canDelete={r.uid === currentUid} onDelete={() => deleteReaction(r.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReactionItem({ reaction, canDelete, onDelete }: {
  reaction: EpisodeReaction; canDelete: boolean; onDelete: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const name = reaction.displayName || reaction.username || 'Användare';
  const masked = reaction.spoiler && !revealed;
  return (
    <div className="text-xs">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-text-primary">{name}</span>
        {canDelete && (
          <button type="button" onClick={onDelete} className="text-xxs text-text-muted bg-transparent border-none cursor-pointer">Ta bort</button>
        )}
      </div>
      {masked ? (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="text-xxs text-acc-deep bg-transparent border-none p-0 cursor-pointer italic"
        >
          Spoiler — klicka för att visa
        </button>
      ) : (
        <p className="text-xs text-text-secondary leading-snug m-0 whitespace-pre-wrap">{reaction.text}</p>
      )}
    </div>
  );
}
