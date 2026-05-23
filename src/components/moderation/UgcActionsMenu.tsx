'use client';

import { useState, useRef, useEffect } from 'react';
import { MoreHorizontal, Flag, UserX, UserCheck } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useBlockedUsers } from '@/hooks/useBlockedUsers';
import { useToast } from '@/contexts/ToastContext';
import {
  createReport,
  REPORT_REASON_LABELS,
  type ReportReason,
  type ReportTargetType,
} from '@/lib/firebase/reports';

/**
 * UGC-åtgärdsmeny (Rapportera / Blockera) för reviews, comments och
 * userlänkade element. Visas som en diskret "…"-knapp i hörnet av content-
 * blocket.
 *
 * Klient-side filter: useBlockedUsers används av review/feed-listor för att
 * gömma blockerad användares innehåll (hygienfilter, ej säkerhetsgräns).
 *
 * Rapporter skrivs till top-level reports/ collection; admin-flödet körs
 * manuellt via Firebase Console tills vi bygger ett admin-UI.
 */
export function UgcActionsMenu({
  targetType,
  targetId,
  targetOwnerUid,
  targetOwnerName,
  className = '',
}: {
  targetType: ReportTargetType;
  targetId: string;
  targetOwnerUid: string;
  targetOwnerName?: string;
  className?: string;
}) {
  const { uid } = useAuth();
  const { isBlocked, blockUser, unblockUser } = useBlockedUsers();
  const { show: toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Stäng på click-outside + Escape.
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  // Gömma menyn helt om det är användarens eget innehåll — man blockerar/
  // rapporterar inte sig själv.
  if (!uid || uid === targetOwnerUid) return null;

  const blocked = isBlocked(targetOwnerUid);

  const handleBlock = async () => {
    setOpen(false);
    if (blocked) {
      await unblockUser(targetOwnerUid);
      toast(`Avblockerade ${targetOwnerName ?? 'användaren'}.`);
    } else {
      await blockUser(targetOwnerUid);
      toast(`Blockerade ${targetOwnerName ?? 'användaren'}. Du ser inte deras innehåll längre.`);
    }
  };

  return (
    <div ref={menuRef} className={`relative inline-block ${className}`}>
      <button
        onClick={() => setOpen(v => !v)}
        className="text-text-muted hover:text-text-secondary p-1 cursor-pointer"
        aria-label="Åtgärder"
        title="Åtgärder"
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-[2px] bg-surface border border-border-main rounded-sm min-w-[160px] z-20">
          <button
            onClick={() => { setOpen(false); setReporting(true); }}
            className="w-full flex items-center gap-2 px-3 py-[6px] text-xs text-text-secondary hover:bg-surface-hover cursor-pointer"
          >
            <Flag size={11} /> Rapportera
          </button>
          <button
            onClick={handleBlock}
            className="w-full flex items-center gap-2 px-3 py-[6px] text-xs text-text-secondary hover:bg-surface-hover cursor-pointer border-t border-border-light"
          >
            {blocked ? <UserCheck size={11} /> : <UserX size={11} />}
            {blocked ? 'Avblockera' : 'Blockera användare'}
          </button>
        </div>
      )}
      {reporting && (
        <ReportDialog
          targetType={targetType}
          targetId={targetId}
          targetOwnerUid={targetOwnerUid}
          onClose={() => setReporting(false)}
        />
      )}
    </div>
  );
}

function ReportDialog({
  targetType,
  targetId,
  targetOwnerUid,
  onClose,
}: {
  targetType: ReportTargetType;
  targetId: string;
  targetOwnerUid: string;
  onClose: () => void;
}) {
  const { uid } = useAuth();
  const { show: toast } = useToast();
  const [reason, setReason] = useState<ReportReason>('spam');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uid) return;
    setError(null);
    setSubmitting(true);
    try {
      await createReport({
        reporterUid: uid,
        targetType,
        targetId,
        targetOwnerUid,
        reason,
        note: note.trim() || undefined,
      });
      toast('Rapporten skickad. Den granskas av en moderator.');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte skicka rapporten.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
      role="presentation"
    >
      <form
        onSubmit={submit}
        onClick={e => e.stopPropagation()}
        className="bg-surface border border-border-main rounded-sm max-w-[440px] w-full"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-dialog-title"
      >
        <div className="px-3 py-2 border-b border-border-light">
          <h2 id="report-dialog-title" className="text-sm font-bold">Rapportera innehåll</h2>
        </div>
        <div className="px-3 py-3 space-y-3">
          <div>
            <label className="block text-xxs uppercase tracking-[0.5px] text-text-muted font-semibold mb-1">
              Anledning
            </label>
            <select
              value={reason}
              onChange={e => setReason(e.target.value as ReportReason)}
              className="w-full px-2 py-1 text-xs border border-border-main rounded-sm bg-white"
            >
              {Object.entries(REPORT_REASON_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xxs uppercase tracking-[0.5px] text-text-muted font-semibold mb-1">
              Kommentar (valfritt)
            </label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Extra kontext för moderationen…"
              className="w-full px-2 py-1 text-xs border border-border-main rounded-sm bg-white font-[inherit] resize-none"
            />
            <div className="text-xxs text-text-muted mt-[2px] text-right">
              {note.length}/500
            </div>
          </div>
          {error && <div className="text-xxs text-red-700">{error}</div>}
        </div>
        <div className="px-3 py-2 border-t border-border-light flex items-center gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="px-3 py-[5px] bg-accent text-white rounded-sm text-xs font-semibold cursor-pointer disabled:opacity-50"
          >
            {submitting ? 'Skickar…' : 'Skicka rapport'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-[5px] border border-border-main rounded-sm text-xs bg-white cursor-pointer"
          >
            Avbryt
          </button>
        </div>
      </form>
    </div>
  );
}
