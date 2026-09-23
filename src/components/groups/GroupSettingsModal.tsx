'use client';

import { useEffect, useState } from 'react';
import { Trash2, X, UserCheck } from 'lucide-react';
import { updateGroup } from '@/lib/firebase/groups';
import { HandOverGroupDialog } from '@/components/groups/HandOverGroupDialog';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type {
  AggregationStrategy,
  GroupDefaults,
  GroupMember,
  ProviderMode,
  SessionMediaType,
} from '@/types';

/**
 * Modal för att redigera gruppens namn + sessions-defaults.
 * Owner-only access — gate:as i GroupContent via isOwner-check innan render.
 *
 * onDelete triggas via "Radera grupp"-knapp och kräver en designad
 * ConfirmDialog (G1) innan parent tar beslutet om radering. Stängs på
 * Escape eller backdrop-klick.
 */
export function GroupSettingsModal({
  groupId, name, defaults, members, memberUids, myUid, onClose, onDelete, onHandedOver,
}: {
  groupId: string;
  name: string;
  defaults: GroupDefaults;
  /** Everyone in the group, the owner included — the dialog filters themselves out. */
  members: GroupMember[];
  /** The group document's `memberUids` — the ballot the server validates the pick against. */
  memberUids: string[];
  myUid: string;
  onClose: () => void;
  onDelete: () => void;
  onHandedOver: () => void;
}) {
  const [editName, setEditName] = useState(name);
  const [providerMode, setProviderMode] = useState<ProviderMode>(defaults.providerMode);
  const [aggregation, setAggregation] = useState<AggregationStrategy>(defaults.aggregation);
  const [mediaType, setMediaType] = useState<SessionMediaType>(defaults.mediaType);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [handingOver, setHandingOver] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // An owner alone in their group has nobody to pick, so
  // the button is disabled rather than opening a dialog with an empty list —
  // "Radera grupp" is the honest action there, and it is right next to it.
  //
  // BIN-1269, Malins beslut 2026-09-23: bara rader vars uid ocksa star i gruppens
  // `memberUids`. Servern validerar valet mot den listan, sa en kvarliggande
  // medlemsrad utan medlemskap hade erbjudits och sedan nekats efter klicket.
  const handoverCandidates = members.filter(m => m.uid !== myUid && memberUids.includes(m.uid));

  // Stäng på Escape (tangentbord-a11y; klick-on-backdrop täcker mus).
  // ConfirmDialog stoppar Escape-propagering själv, men gate:a ändå så
  // settings-modalen inte stängs medan raderings-bekräftelsen är öppen.
  //
  // BIN-1118: överlämningsdialogen måste stå i samma villkor. Den kan stå öppen
  // med ett anrop i luften i upp till 300 sekunder — stängdes båda av ett
  // tangenttryck rapporterades ingenting till den som bad om överlämningen,
  // medan servern körde vidare.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirmingDelete && !handingOver) onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, confirmingDelete, handingOver]);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await updateGroup(groupId, {
        name: editName.trim() || name,
        defaults: { providerMode, aggregation, mediaType },
      });
    } catch (err) {
      console.error('updateGroup: inställningarna sparades inte', err);
      setSaveError('Inställningarna kunde inte sparas. Försök igen.');
      return;
    } finally {
      setSaving(false);
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
      onKeyDown={e => { if (e.key === 'Escape' && !confirmingDelete && !handingOver) onClose(); }}
      role="presentation"
    >
      <div
        className="bg-surface border border-rule rounded-sm max-w-[480px] w-full"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-settings-title"
      >
        <div className="px-3 py-2 border-b border-rule-2 flex items-center justify-between">
          <h2 id="group-settings-title" className="text-sm font-bold">Gruppinställningar</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Stäng gruppinställningar"
            className="text-ink-3 hover:text-ink cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-3 py-3 space-y-3">
          <div>
            <label className="block text-xxs uppercase tracking-[0.5px] text-ink-3 font-semibold mb-1">Namn</label>
            <input
              type="text"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              maxLength={48}
              className="w-full px-2 py-1 text-base border border-rule rounded-sm bg-white"
            />
          </div>

          <div>
            <label className="block text-xxs uppercase tracking-[0.5px] text-ink-3 font-semibold mb-1">Standardinnehåll</label>
            <select
              value={mediaType}
              onChange={e => setMediaType(e.target.value as SessionMediaType)}
              className="select w-full"
            >
              <option value="movie">Bara filmer</option>
              <option value="tv">Bara serier</option>
              <option value="both">Blandat</option>
            </select>
          </div>

          <div>
            <label className="block text-xxs uppercase tracking-[0.5px] text-ink-3 font-semibold mb-1">Standardläge för tjänster</label>
            <select
              value={providerMode}
              onChange={e => setProviderMode(e.target.value as ProviderMode)}
              className="select w-full"
            >
              <option value="intersect">Alla har</option>
              <option value="union">Någon har</option>
            </select>
          </div>

          <div>
            <label className="block text-xxs uppercase tracking-[0.5px] text-ink-3 font-semibold mb-1">Standardurval</label>
            <select
              value={aggregation}
              onChange={e => setAggregation(e.target.value as AggregationStrategy)}
              className="select w-full"
            >
              <option value="least_misery">Ingen hatar det</option>
              <option value="average">Flest positiva</option>
              <option value="fair">Turordning</option>
            </select>
          </div>
        </div>

        {saveError && (
          <div className="px-3 pb-2">
            <p className="text-xs bg-danger-soft text-danger-ink px-2 py-1 rounded-sm">{saveError}</p>
          </div>
        )}

        <div className="px-3 py-2 border-t border-rule-2 flex items-center gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="px-3 py-[5px] bg-acc-deep text-white rounded-sm text-xs font-semibold cursor-pointer disabled:opacity-50"
          >
            {saving ? 'Sparar…' : 'Spara'}
          </button>
          <button
            onClick={onClose}
            className="px-3 py-[5px] border border-rule rounded-sm text-xs bg-white cursor-pointer"
          >
            Avbryt
          </button>
          {/* BIN-1118: överlämningen står FÖRE raderingen, och det är avsiktligt.
              En ägare som vill sluta sköta gruppen hade tidigare bara två vägar,
              båda oproportionerliga: radera gruppen för alla, eller radera hela
              sitt konto. Den mildare vägen ska läsas först. */}
          <button
            onClick={() => setHandingOver(true)}
            disabled={handoverCandidates.length === 0}
            title={
              handoverCandidates.length === 0
                ? 'Du är ensam i gruppen — det finns ingen att lämna över till.'
                : undefined
            }
            className="ml-auto inline-flex items-center gap-1 px-3 py-[5px] border border-rule rounded-sm text-xs bg-white cursor-pointer hover:bg-bg-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <UserCheck size={11} /> Lämna över
          </button>
          <button
            onClick={() => setConfirmingDelete(true)}
            className="inline-flex items-center gap-1 px-3 py-[5px] border border-danger/40 text-danger-ink rounded-sm text-xs bg-white cursor-pointer hover:bg-danger-soft"
          >
            <Trash2 size={11} /> Radera grupp
          </button>
        </div>
      </div>

      {handingOver && (
        <HandOverGroupDialog
          groupId={groupId}
          groupName={name}
          candidates={handoverCandidates}
          onDone={onHandedOver}
          onCancel={() => setHandingOver(false)}
        />
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title="Radera gruppen permanent?"
          body="Medlemmar, gemensamt bibliotek och sessionshistorik raderas. Det går inte att ångra."
          confirmLabel="Radera grupp"
          onConfirm={() => { setConfirmingDelete(false); onDelete(); }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}
