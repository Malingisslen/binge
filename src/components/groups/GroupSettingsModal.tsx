'use client';

import { useEffect, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { updateGroup } from '@/lib/firebase/groups';
import type {
  AggregationStrategy,
  GroupDefaults,
  ProviderMode,
  SessionMediaType,
} from '@/types';

/**
 * Modal för att redigera gruppens namn + sessions-defaults.
 * Owner-only access — gate:as i GroupContent via isOwner-check innan render.
 *
 * onDelete triggas via "Radera grupp"-knapp och kräver en confirm() innan
 * parent tar beslutet om radering. Stängs på Escape eller backdrop-klick.
 */
export function GroupSettingsModal({
  groupId, name, defaults, onClose, onDelete,
}: {
  groupId: string;
  name: string;
  defaults: GroupDefaults;
  onClose: () => void;
  onDelete: () => void;
}) {
  const [editName, setEditName] = useState(name);
  const [providerMode, setProviderMode] = useState<ProviderMode>(defaults.providerMode);
  const [aggregation, setAggregation] = useState<AggregationStrategy>(defaults.aggregation);
  const [mediaType, setMediaType] = useState<SessionMediaType>(defaults.mediaType);
  const [saving, setSaving] = useState(false);

  // Stäng på Escape (tangentbord-a11y; klick-on-backdrop täcker mus).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const save = async () => {
    setSaving(true);
    try {
      await updateGroup(groupId, {
        name: editName.trim() || name,
        defaults: { providerMode, aggregation, mediaType },
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
      onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
      role="presentation"
    >
      <div
        className="bg-surface border border-border-main rounded-sm max-w-[480px] w-full"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-settings-title"
      >
        <div className="px-3 py-2 border-b border-border-light flex items-center justify-between">
          <h2 id="group-settings-title" className="text-sm font-bold">Gruppinställningar</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Stäng gruppinställningar"
            className="text-text-muted hover:text-text-primary cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-3 py-3 space-y-3">
          <div>
            <label className="block text-xxs uppercase tracking-[0.5px] text-text-muted font-semibold mb-1">Namn</label>
            <input
              type="text"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              maxLength={48}
              className="w-full px-2 py-1 text-base border border-border-main rounded-sm bg-white"
            />
          </div>

          <div>
            <label className="block text-xxs uppercase tracking-[0.5px] text-text-muted font-semibold mb-1">Default vad?</label>
            <select
              value={mediaType}
              onChange={e => setMediaType(e.target.value as SessionMediaType)}
              className="w-full px-2 py-1 text-xs border border-border-main rounded-sm bg-white"
            >
              <option value="movie">Bara filmer</option>
              <option value="tv">Bara serier</option>
              <option value="both">Blandat</option>
            </select>
          </div>

          <div>
            <label className="block text-xxs uppercase tracking-[0.5px] text-text-muted font-semibold mb-1">Default provider-läge</label>
            <select
              value={providerMode}
              onChange={e => setProviderMode(e.target.value as ProviderMode)}
              className="w-full px-2 py-1 text-xs border border-border-main rounded-sm bg-white"
            >
              <option value="intersect">Alla har (intersect)</option>
              <option value="union">Någon har (union)</option>
            </select>
          </div>

          <div>
            <label className="block text-xxs uppercase tracking-[0.5px] text-text-muted font-semibold mb-1">Default aggregering</label>
            <select
              value={aggregation}
              onChange={e => setAggregation(e.target.value as AggregationStrategy)}
              className="w-full px-2 py-1 text-xs border border-border-main rounded-sm bg-white"
            >
              <option value="least_misery">Ingen hatar det</option>
              <option value="average">Flest positiva</option>
              <option value="fair">Turordning</option>
            </select>
          </div>
        </div>

        <div className="px-3 py-2 border-t border-border-light flex items-center gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="px-3 py-[5px] bg-accent text-white rounded-sm text-xs font-semibold cursor-pointer disabled:opacity-50"
          >
            {saving ? 'Sparar...' : 'Spara'}
          </button>
          <button
            onClick={onClose}
            className="px-3 py-[5px] border border-border-main rounded-sm text-xs bg-white cursor-pointer"
          >
            Avbryt
          </button>
          <button
            onClick={() => {
              if (confirm('Radera gruppen permanent? Det går inte att ångra.')) onDelete();
            }}
            className="ml-auto inline-flex items-center gap-1 px-3 py-[5px] border border-red-300 text-red-700 rounded-sm text-xs bg-white cursor-pointer"
          >
            <Trash2 size={11} /> Radera grupp
          </button>
        </div>
      </div>
    </div>
  );
}
