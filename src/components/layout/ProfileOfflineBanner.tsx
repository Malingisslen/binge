'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { needsOnboarding } from '@/lib/onboarding';
import { clearNextPath, isSignInPath, rememberNextPath } from '@/lib/nextPath';

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
  const { uid, user, profileLoading, profileLoadError, retryProfileLoad } = useAuth();
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  // BIN-1293: räknas upp när ett tryck på "Försök igen" har gått klart, så att
  // effekten nedan körs då. Refen håller vilket tryck som redan är hanterat
  // (StrictMode), samma skäl som inloggningssidans `redirectedRef`.
  const [retriesDone, setRetriesDone] = useState(0);
  const handledRef = useRef(0);

  // BIN-1293: ett helt nytt konto som loggade in offline landade utanför
  // onboardingen, eftersom inloggningssidan inte kunde läsa profilen. Skapar
  // omförsöket profilen, ställs samma fråga som inloggningssidan ställer. Bara
  // efter ett tryck här, aldrig vid en vanlig laddning.
  useEffect(() => {
    if (retriesDone === handledRef.current || profileLoading) return;
    handledRef.current = retriesDone;
    if (profileLoadError !== null || !needsOnboarding(user)) return;
    const here = window.location.pathname + window.location.search;
    if (isSignInPath(here)) return;
    // Onboardingen är en omväg, inte ett avbrott (BIN-669): den tar sidan man
    // stod på när flödet är klart. Rensa först, som AuthGuard gör: en äldre
    // sparad sida ska inte överleva om den här skulle vägras.
    clearNextPath();
    rememberNextPath(here);
    router.push('/onboarding/');
  }, [retriesDone, user, profileLoading, profileLoadError, router]);

  if (!uid || profileLoadError !== 'offline') return null;

  const retry = async () => {
    setRetrying(true);
    try {
      await retryProfileLoad();
    } finally {
      setRetrying(false);
      setRetriesDone((n) => n + 1);
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
