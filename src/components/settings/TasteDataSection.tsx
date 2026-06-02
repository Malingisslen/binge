'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Sparkles, Target } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/contexts/ToastContext';
import { backfillGenreIds, type BackfillProgress } from '@/lib/taste/backfill';
import { SettingsSection } from './SettingsSection';

export function TasteDataSection() {
  const { uid } = useAuth();
  const { show: toast } = useToast();
  const [progress, setProgress] = useState<BackfillProgress | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    if (!uid || running) return;
    setRunning(true);
    setProgress({ total: 0, processed: 0, updated: 0, refreshed: 0, skipped: 0, failed: 0 });
    try {
      const final = await backfillGenreIds(uid, p => setProgress({ ...p }));
      toast(`Klar — ${final.updated} titlar uppdaterade`);
    } catch {
      toast('Kunde inte uppdatera smakdata. Kontrollera anslutningen och försök igen.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <SettingsSection title="Smakdata">
      <p className="text-xs text-ink-2 mb-2">
        Fyll i genrer och streamingtjänster på äldre titlar i ditt bibliotek så de syns i Följer/Vill se och bidrar till smak-match. Körs en gång — nya titlar sparas automatiskt.
      </p>
      <button
        onClick={run}
        disabled={running}
        className="btn btn-acc btn-sm disabled:opacity-50"
      >
        <Sparkles size={11} />
        {running ? 'Uppdaterar…' : 'Uppdatera smakdata'}
      </button>
      {progress && progress.total > 0 && (
        <div className="mt-2 text-xxs text-ink-3">
          {progress.processed}/{progress.total} — {progress.updated} uppdaterade
          {progress.refreshed > 0 ? `, ${progress.refreshed} bekräftade mot källa` : ''}
          {progress.skipped > 0 ? `, ${progress.skipped} hoppade över` : ''}
          {progress.failed > 0 ? `, ${progress.failed} misslyckade` : ''}
        </div>
      )}
      {progress && progress.total === 0 && !running && (
        <div className="mt-2 text-xxs text-ink-3">
          Ingenting att uppdatera — alla titlar har redan genrer och providers.
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-rule-2">
        <p className="text-xs text-ink-2 mb-2">
          Justera smakmatchningen genom att ranka genrer du gillar.
        </p>
        <Link href="/kalibrera" className="btn btn-ghost btn-sm no-underline">
          <Target size={11} />
          Kalibrera smak
        </Link>
      </div>
    </SettingsSection>
  );
}
