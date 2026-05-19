'use client';

import Link from 'next/link';
import { useSubscriptionAdvisor } from '@/hooks/useSubscriptionAdvisor';
import { getProvider } from '@/lib/tmdb/providers';

// Right rail's Sparande tile: monthly savings number + a paused-service card
// with a resume link. Direction H spec: tabular numbers, one accent (saffran)
// only on the resume button, hairline-dashed border around the paused card.

export default function SparandeTile() {
  const advisor = useSubscriptionAdvisor();

  if (advisor.isLoading && advisor.providers.length === 0) return null;
  if (advisor.providers.length === 0) return null;

  const pausable = advisor.providers.filter(p => p.status === 'pause');
  const totalSavings = pausable.reduce((sum, p) => sum + (p.monthlyCost ?? 0), 0);
  const featured = pausable[0];
  const featuredProvider = featured ? getProvider(featured.providerId) : null;

  return (
    <section className="tile sparande" aria-label="Sparande">
      <div className="h">
        <span>Sparande · denna månad</span>
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
