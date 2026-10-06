'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/contexts/ToastContext';
import { formatKr } from '@/lib/formatKr';
import { formatSwedishDate } from '@/lib/utils';

// BIN-1442 — right after Pausa: "Påminn mig" the day the pause ends. Approved
// wording (Malin, 2026-10-06). The reminder arrives in the bell, and as a push
// when push is on (rotationReminderNotify's pause pass).

interface Props {
  providerId: number;
  providerName: string;
  resumeAt: string;
  monthlyCost: number | null;
  onDone: () => void;
}

export default function PauseReminderPrompt({ providerId, providerName, resumeAt, monthlyCost, onDone }: Props) {
  const { setPauseReminder } = useAuth();
  const { show: toast } = useToast();
  const [busy, setBusy] = useState(false);
  const date = formatSwedishDate(resumeAt);

  const remind = async () => {
    setBusy(true);
    try {
      await setPauseReminder(providerId, true);
      toast(`Binge påminner dig ${date}`);
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Kunde inte spara påminnelsen. Försök igen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-surface border border-rule rounded-sm p-3 mb-[14px]" role="status">
      <p className="text-sm font-semibold text-ink">{providerName} pausad till {date}</p>
      {monthlyCost != null && monthlyCost > 0 && (
        <p className="text-xs text-ink-2 mt-[2px]">Du sparar <strong>{formatKr(monthlyCost)} kr/mån</strong>.</p>
      )}
      <div className="flex flex-wrap gap-2 mt-2">
        <button type="button" className="btn btn-sm" onClick={() => { void remind(); }} disabled={busy}>
          Påminn mig {date}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDone} disabled={busy}>
          Inte nu
        </button>
      </div>
    </div>
  );
}
