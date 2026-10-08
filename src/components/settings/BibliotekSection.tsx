'use client';

import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/contexts/ToastContext';
import { SettingsSection } from './SettingsSection';
import { MunicipalityPicker } from './MunicipalityPicker';
import { Button } from '@/components/ui/Button';

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
      <div className="flex items-start gap-2 flex-wrap">
        <MunicipalityPicker
          value={user.hemkommun ?? null}
          onSelect={async name => {
            try {
              await updateHomeMunicipality(name);
              toast(`Hemkommun: ${name}`);
              return true;
            } catch {
              toast('Kunde inte spara. Försök igen om en stund.');
              return false;
            }
          }}
        />
        {user.hemkommun && (
          <Button
            type="button"
            onClick={async () => {
              try { await updateHomeMunicipality(null); toast('Hemkommun rensad'); }
              catch { toast('Kunde inte spara. Försök igen om en stund.'); }
            }}
            variant="ghost" size="sm"
          >
            Rensa
          </Button>
        )}
      </div>
    </SettingsSection>
  );
}
