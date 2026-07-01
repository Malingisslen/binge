'use client';

// BIN-164 — per-title tag editor. Tags are PRIVATE to the owner (stored in the
// owner-only watchlistTags subcollection, never on the public watchlist doc).
// Composable like NotesBlock: parent passes current tags + onChange (wired to
// WatchlistContext.updateTags) + suggestions (the user's own existing tags).

import { useState } from 'react';
import { X } from 'lucide-react';
import { normalizeTags } from '@/lib/watchlistWrites';
import { GENRE_LABELS } from '@/lib/tmdb/genreLabels';

// Reserved folds: a user tag must not masquerade as a real genre/rating chip.
const RESERVED = new Set<string>([
  ...Object.values(GENRE_LABELS).map(g => g.toLocaleLowerCase('sv-SE')),
  '3+★', '4+★', '4.5+★',
]);

interface TagEditorProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  /** The user's own existing tags across the library, for autocomplete. */
  suggestions: string[];
}

export default function TagEditor({ tags, onChange, suggestions }: TagEditorProps) {
  const [open, setOpen] = useState(tags.length > 0);
  const [draft, setDraft] = useState('');

  function commit(raw: string) {
    const merged = normalizeTags([...tags, raw], RESERVED);
    // Only fire onChange when the set actually changed (avoids a redundant write
    // on a duplicate/reserved/empty entry).
    if (merged.length !== tags.length || merged.some((t, i) => t !== tags[i])) {
      onChange(merged);
    }
    setDraft('');
  }

  function remove(tag: string) {
    onChange(tags.filter(t => t !== tag));
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-ink-3 bg-transparent border-none cursor-pointer font-[inherit] p-0 mb-2 hover:text-acc-deep"
      >
        + Tagg
      </button>
    );
  }

  // Suggestions not already applied to this title.
  const remaining = suggestions.filter(s => !tags.includes(s));

  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-[6px]">
        {tags.map(t => (
          <span key={t} className="chip is-on inline-flex items-center gap-[4px]">
            {t}
            <button
              type="button"
              aria-label={`Ta bort taggen ${t}`}
              onClick={() => remove(t)}
              className="bg-transparent border-none p-0 cursor-pointer inline-flex text-ink-2 hover:text-danger-ink"
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          list="tag-suggestions"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              if (draft.trim()) commit(draft);
            }
          }}
          onBlur={() => { if (draft.trim()) commit(draft); }}
          placeholder="Lägg till tagg…"
          maxLength={24}
          className="text-xs bg-surface border border-rule rounded px-[8px] py-[3px] text-ink placeholder:text-ink-3 outline-none focus:border-acc-deep min-w-[120px]"
        />
        {remaining.length > 0 && (
          <datalist id="tag-suggestions">
            {remaining.map(s => <option key={s} value={s} />)}
          </datalist>
        )}
      </div>
    </div>
  );
}
