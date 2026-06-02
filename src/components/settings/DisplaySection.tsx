'use client';

import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/contexts/ToastContext';
import { SettingsSection } from './SettingsSection';

export function DisplaySection() {
  const { user, updateDefaultView } = useAuth();
  const { show: toast } = useToast();
  if (!user) return null;

  return (
    <SettingsSection title="Visning">
      <p className="text-xs text-ink-3 mb-2">Standardvy för listor.</p>
      <div className="flex gap-2">
        {(['table', 'cards', 'grid'] as const).map(v => (
          <button
            key={v}
            onClick={() => { updateDefaultView(v); toast('Inställning sparad'); }}
            className={`btn btn-sm ${user.defaultView === v ? 'btn-acc' : 'btn-ghost'}`}
          >
            {v === 'table' ? 'Tabell' : v === 'cards' ? 'Kort' : 'Rutnät'}
          </button>
        ))}
      </div>
    </SettingsSection>
  );
}
