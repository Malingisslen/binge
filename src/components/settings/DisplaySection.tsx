'use client';

import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/contexts/ToastContext';
import { useTheme, type ThemeMode } from '@/contexts/ThemeContext';
import { SettingsSection } from './SettingsSection';

const THEME_LABELS: Record<ThemeMode, string> = { system: 'System', light: 'Ljust', dark: 'Mörkt' };

export function DisplaySection() {
  const { user, updateDefaultView } = useAuth();
  const { show: toast } = useToast();
  const { mode, setMode } = useTheme();
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

      {/* BIN-67 — tema. 'System' följer OS; valet sparas i localStorage. */}
      <p className="text-xs text-ink-3 mt-4 mb-2">Tema.</p>
      <div className="flex gap-2">
        {(['system', 'light', 'dark'] as const).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={`btn btn-sm ${mode === m ? 'btn-acc' : 'btn-ghost'}`}
          >
            {THEME_LABELS[m]}
          </button>
        ))}
      </div>
    </SettingsSection>
  );
}
