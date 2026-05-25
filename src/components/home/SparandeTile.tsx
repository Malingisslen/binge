'use client';

import Link from 'next/link';
import { useSubscriptionAdvisor } from '@/hooks/useSubscriptionAdvisor';
import { useAuth } from '@/hooks/useAuth';
import { getProvider } from '@/lib/tmdb/providers';

// Right rail's Sparande tile: monthly savings number + a paused-service card
// with a resume link. Direction H spec: tabular numbers, one accent (saffran)
// only on the resume button, hairline-dashed border around the paused card.

// Dimensions-matched skeleton: useSubscriptionAdvisor fanar ut en TMDB-query
// per TV-titel och beräknar `providers` progressivt — utan skelettet skulle
// kr-talet flippa nedåt medan svaren trillar in (providers flyttar från
// `pause` till `active`/`upcoming` när vi upptäcker kommande avsnitt). Höjden
// här matchar det vanliga (totalSavings > 0)-varianten så right-rail under
// inte hoppar när datan landar.
function SparandeTileSkeleton() {
  return (
    <section className="tile sparande" aria-label="Streamingrådgivaren" aria-busy="true">
      <div className="h">
        <span>Streamingrådgivaren</span>
        <span className="more" aria-hidden="true">öppna →</span>
      </div>
      <div className="sparande-skel-val" aria-hidden="true" />
      <div className="sparande-skel-note" aria-hidden="true" />
      <div className="sparande-skel-pause" aria-hidden="true" />
    </section>
  );
}

export default function SparandeTile() {
  const advisor = useSubscriptionAdvisor();
  const { user } = useAuth();

  // Användare utan konfigurerade providers ska aldrig se tilen — vi vill inte
  // blinka ett skelett som sedan försvinner. user.myProviders finns så fort
  // auth resolverats, oberoende av TMDB-fetches.
  const hasConfiguredProviders = (user?.myProviders?.length ?? 0) > 0;
  if (!hasConfiguredProviders) return null;

  if (advisor.isLoading) return <SparandeTileSkeleton />;
  if (advisor.providers.length === 0) return null;

  const pausable = advisor.providers.filter(p => p.status === 'pause');
  const totalSavings = pausable.reduce((sum, p) => sum + (p.monthlyCost ?? 0), 0);
  const featured = pausable[0];
  const featuredProvider = featured ? getProvider(featured.providerId) : null;

  return (
    <section className="tile sparande" aria-label="Streamingrådgivaren">
      <div className="h">
        <span>Streamingrådgivaren</span>
        <Link href="/savings/" className="more">öppna →</Link>
      </div>
      {totalSavings > 0 ? (
        <>
          <div className="val tnum">
            {totalSavings}<span className="unit">kr</span>
          </div>
          <p className="note">
            {pausable.length === 1 ? (
              <>
                <strong>{featuredProvider?.shortName ?? featured?.providerName}</strong> kan pausas
                — du tittar inget aktivt där just nu.
              </>
            ) : (
              <>
                <strong>{pausable.length} tjänster</strong> kan pausas — du tittar inget aktivt
                på dem just nu.
              </>
            )}
          </p>
          {featured && (
            <div className="pause">
              <div>
                <div className="svc">{featuredProvider?.shortName ?? featured.providerName}</div>
                <div>
                  pausa · <strong>{featured.monthlyCost ?? 0} kr/mån</strong>
                </div>
              </div>
              <Link href="/savings/" className="btn btn-ghost btn-sm">
                hantera
              </Link>
            </div>
          )}
        </>
      ) : (
        <p className="note">
          Alla dina tjänster används aktivt — inget att pausa just nu.
        </p>
      )}
    </section>
  );
}
