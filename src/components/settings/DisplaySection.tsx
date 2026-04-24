'use client';

import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/contexts/ToastContext';
import { SettingsCard } from './SettingsCard';

export function DisplaySection() {
  const { user, updateDefaultView } = useAuth();
  const { show: toast } = useToast();
  if (!user) return null;

  return (
    <SettingsCard title="Visning">
      <p className="text-xs text-text-muted mb-2">Standardvy för listor.</p>
      <div className="flex gap-2">
        {(['table', 'grid'] as const).map(v => (
          <button
            key={v}
            onClick={() => { updateDefaultView(v); toast('Inställning sparad'); }}
            className={`px-3 py-[3px] border rounded-sm text-xs font-[inherit] cursor-pointer ${
              user.defaultView === v
                ? 'bg-accent text-white border-accent'
                : 'bg-surface text-text-secondary border-border-main hover:bg-surface-hover'
            }`}
          >
            {v === 'table' ? 'Tabell' : 'Rutnät'}
          </button>
        ))}
      </div>
    </SettingsCard>
  );
}
