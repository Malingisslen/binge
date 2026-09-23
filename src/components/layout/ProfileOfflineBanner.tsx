'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';

/**
 * BIN-559 — inloggad, men profilen gick inte att läsa för att enheten saknar
 * anslutning. Malins beslut 2026-09-23: en röd remsa under menyn, samma plats som
 * e-postverifieringens banderoll, med hennes text.
 *
 * `role="alert"`: det här är en trasig session, inte en påminnelse. Remsan monteras
 * bara när felet finns, så skärmläsaren läser upp den när den dyker upp.
 *
 * Knappen är avstängd medan ett försök pågår — flera tryck i rad ska inte starta
 * flera laddningar samtidigt. Misslyckas försöket står remsan kvar.
 */
export function ProfileOfflineBanner() {
  const { uid, profileLoadError, retryProfileLoad } = useAuth();
  const [retrying, setRetrying] = useState(false);

  if (!uid || profileLoadError !== 'offline') return null;

  const retry = async () => {
    setRetrying(true);
    try {
      await retryProfileLoad();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div
      role="alert"
      className="bg-danger-soft border-b border-danger/30 px-3 py-[5px] text-xs text-danger-ink flex items-center gap-3 flex-wrap"
    >
      <span>Ingen anslutning, försök igen.</span>
      <button
        type="button"
        onClick={retry}
        disabled={retrying}
        className="text-xs text-danger-ink bg-transparent border-none cursor-pointer font-semibold disabled:opacity-50 underline"
      >
        {retrying ? 'Försöker…' : 'Försök igen'}
      </button>
    </div>
  );
}
