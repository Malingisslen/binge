'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Tv } from 'lucide-react';
import { useTvDevices, type TvDevice } from '@/hooks/useTvDevices';
import { useToast } from '@/contexts/ToastContext';
import { SettingsSection } from './SettingsSection';
import { Button, buttonClass } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { tvDeviceSubtitle } from '@/lib/tvDeviceDates';

type Pending = { kind: 'one'; device: TvDevice } | { kind: 'all' } | null;

export function TvDevicesSection() {
  const { devices, disconnect, disconnectAll } = useTvDevices();
  const { show: toast } = useToast();
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!pending || !devices) return;
    setBusy(true);
    try {
      if (pending.kind === 'one') await disconnect(pending.device.id);
      else await disconnectAll(devices.map(d => d.id));
      setPending(null);
    } catch {
      toast(pending.kind === 'one'
        ? 'Kunde inte koppla bort. Försök igen.'
        : 'Kunde inte koppla bort alla. Några kan vara kvar, kontrollera listan och försök igen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection title="Kopplade TV">
      <p className="text-xs text-ink-3 mb-2">
        TV:n visar din Vill se, kalender och nästa avsnitt. Den kan inte ändra något annat.
      </p>

      {devices !== null && devices.length === 0 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-ink-2">Ingen TV kopplad</p>
          <Link href="/tv/" className={buttonClass({ variant: 'ghost', size: 'sm' })}>Koppla en TV</Link>
        </div>
      )}

      {devices !== null && devices.length > 0 && (
        <>
          <ul className="divide-y divide-rule-2">
            {devices.map(d => (
              <li key={d.id} className="flex items-center gap-3 py-2">
                <span className="shrink-0 w-9 h-9 rounded-md border border-rule bg-bg-2 text-ink-2 flex items-center justify-center" aria-hidden>
                  <Tv size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-ink truncate">{d.name}</div>
                  <div className="text-xs text-ink-3">{tvDeviceSubtitle(d.createdAt, d.lastSeenAt)}</div>
                </div>
                <Button type="button" variant="danger" size="sm" onClick={() => setPending({ kind: 'one', device: d })}>
                  Koppla bort
                </Button>
              </li>
            ))}
          </ul>
          <div className="mt-2 pt-2 border-t border-rule-2 flex items-center justify-between gap-3">
            <p className="text-xs text-ink-3">Tappat en TV? Logga ut alla på en gång.</p>
            <Button type="button" variant="danger" size="sm" onClick={() => setPending({ kind: 'all' })}>
              Logga ut alla TV
            </Button>
          </div>
        </>
      )}

      {pending && (
        <ConfirmDialog
          title={pending.kind === 'one' ? `Koppla bort ${pending.device.name}?` : 'Logga ut alla TV?'}
          body={pending.kind === 'one'
            ? 'TV:n slutar visa din data. Du kan koppla den igen med en ny kod.'
            : 'Alla kopplade TV slutar visa din data. Du kan koppla dem igen med en ny kod.'}
          confirmLabel={pending.kind === 'one' ? 'Koppla bort' : 'Logga ut alla'}
          busy={busy}
          onConfirm={confirm}
          onCancel={() => setPending(null)}
        />
      )}
    </SettingsSection>
  );
}
