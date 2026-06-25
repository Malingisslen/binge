'use client';

import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/contexts/ToastContext';
import { SettingsSection } from './SettingsSection';
import { MUNICIPALITY_NAMES } from '@/lib/libraries/municipalities';

/**
 * BIN-172 — "Gratis med ditt lånekort": let the user declare their home
 * municipality (= "I have a library card here"). Setting it gates the
 * library-availability layer (Cineasterna/Viddla "gratis via biblioteket").
 *
 * Honesty: we can't read the user's loan balance or verify per-kommun coverage,
 * so the copy frames availability as what *can* be free via the library — never
 * a guarantee.
 */
export function BibliotekSection() {
  const { user, updateHomeMunicipality } = useAuth();
  const { show: toast } = useToast();
  if (!user) return null;

  return (
    <SettingsSection title="Bibliotek">
      <p className="text-xs text-ink-3 mb-2">
        Har du ett lånekort? Välj din hemkommun, så visar vi vad som kan vara{' '}
        gratis via biblioteket (t.ex. Cineasterna). Vi kan inte se ditt lånesaldo
        — bara vad som <em>kan</em> vara gratis.
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <select
          className="select"
          aria-label="Välj hemkommun"
          value={user.hemkommun ?? ''}
          onChange={e => {
            const value = e.target.value || null;
            updateHomeMunicipality(value);
            toast(value ? `Hemkommun: ${value}` : 'Hemkommun rensad');
          }}
        >
          <option value="">Ingen vald</option>
          {MUNICIPALITY_NAMES.map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        {user.hemkommun && (
          <button
            type="button"
            onClick={() => { updateHomeMunicipality(null); toast('Hemkommun rensad'); }}
            className="btn btn-ghost btn-sm"
          >
            Rensa
          </button>
        )}
      </div>
    </SettingsSection>
  );
}
