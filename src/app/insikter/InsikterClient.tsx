'use client';

import { useCallback, type ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { auth } from '@/lib/firebase/config';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoadingView } from '@/components/ui/LoadingView';
import { EmptyState } from '@/components/ui/EmptyState';
import { useDateRange } from './state/useDateRange';
import { useInsightsData } from './state/useInsightsData';
import { InsightsProvider } from './state/InsightsContext';
import { Button } from '@/components/ui/Button';
import { eyebrowClass } from '@/components/ui/Eyebrow';
import { cardClass } from '@/components/ui/Card';
import {
  Toolbar, MetricGrid, MetricTile, TimeSeriesChart, Donut,
  Histogram, TopList, ExplainDrawer,
} from './components';

function Section({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className={eyebrowClass({ size: 'xs', className: 'mb-2' })}>{title}</h2>
      {intro && <p className="text-base text-ink-3 mb-2">{intro}</p>}
      {children}
    </section>
  );
}

/** Read ?token from the URL once (client-only). */
function urlToken(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('token') ?? '';
}

export default function InsikterClient() {
  const { user, loading: authLoading, profileLoading } = useAuth();
  const [range] = useDateRange();

  const token = urlToken();
  const isAdmin = !!user?.isAdmin;
  const hasAccess = isAdmin || !!token;

  // Resolve the bearer credential per fetch: a fresh ID token for an admin,
  // else the static URL token.
  const getToken = useCallback(async (): Promise<string | null> => {
    if (isAdmin && auth.currentUser) return auth.currentUser.getIdToken();
    return token || null;
  }, [isAdmin, token]);

  // Hold the fetch until auth + profile have resolved; only then can getToken
  // mint a real ID token. Re-runs the moment this flips true.
  const ready = !authLoading && !profileLoading && hasAccess;
  const { data, previous, loading, error, lastFetchedAt, isFirstLoad } = useInsightsData(getToken, range, ready);

  const header = (
    <PageHeader
      crumb="Insikter · internt"
      title="Insikter"
      standfirst="Internt analysverktyg — inte länkat i menyn och inte indexerat. Klicka på en ruta för att läsa vad den mäter."
    />
  );

  // ── Access / loading / error gates ─────────────────────────────────────────
  if (authLoading || profileLoading) {
    return <div>{header}<LoadingView label="Kontrollerar behörighet…" /></div>;
  }

  if (!hasAccess) {
    return (
      <div>
        {header}
        <div className="mt-6">
          <EmptyState
            title="Ingen behörighet"
            body="Den här sidan kräver ett admin-konto eller en giltig token i URL:en (?token=…)."
          />
        </div>
      </div>
    );
  }

  if (isFirstLoad && loading) {
    return <div>{header}<LoadingView label="Laddar insikter…" variant="detail" /></div>;
  }

  if (error && !data) {
    return (
      <div>
        {header}
        <div className="mt-6">
          <EmptyState
            title="Kunde inte ladda insikter"
            body={error}
            action={
              <Button type="button" onClick={() => window.location.reload()} variant="acc">
                Försök igen
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  if (!data) {
    return <div>{header}<LoadingView label="Ingen data ännu." /></div>;
  }

  // Händelsemått (sedan BIN-1438) räknar händelser, inte personer, och bara sedan den
  // första räknade dagen — den står i svaret, aldrig hårdkodad här.
  const eventsIntro = (
    <>
      Samma person tre gånger räknas som 3.
      {data.eventsSince ? ` Händelser räknas sedan ${data.eventsSince}.` : ' Händelser har inte räknats än.'}
    </>
  );

  // ── Dashboard ───────────────────────────────────────────────────────────────
  return (
    <InsightsProvider value={{ data, previous }}>
      <div className={loading ? 'opacity-70 transition-opacity' : undefined}>
        {header}

        {(error || data.partial) && (
          <div className="mt-3 rounded-md border border-danger bg-danger-soft text-danger-ink px-3 py-2 text-sm" role="alert">
            {error
              ? <>{error} — <button type="button" onClick={() => window.location.reload()} className="underline">Försök igen</button></>
              : 'Någon siffra kunde inte hämtas just nu. Ladda om sidan om en stund.'}
          </div>
        )}

        <div className="mt-4">
          <Toolbar lastFetchedAt={lastFetchedAt} />
        </div>

        <Section title="Just nu" intro="Ögonblicksbilder från den senaste beräkningen. Följer inte datumväljaren.">
          <MetricGrid>
            <MetricTile metricKey="totalUsers" />
            <MetricTile metricKey="activeUsers7d" />
            <MetricTile metricKey="activeUsers30d" />
            <MetricTile metricKey="totalTitlesTracked" />
            <MetricTile metricKey="totalReviews" />
            <MetricTile metricKey="groupsCount" />
            <MetricTile metricKey="activeSessions" />
          </MetricGrid>
        </Section>

        <Section title="Nya konton i perioden" intro={eventsIntro}>
          <MetricGrid>
            <MetricTile metricKey="newUsers" />
            <MetricTile metricKey="titlesAdded" />
            <MetricTile metricKey="signins" />
          </MetricGrid>
          <div className="grid lg:grid-cols-2 gap-3 mt-3">
            <TimeSeriesChart metricKey="signupsTrend" />
            <Donut metricKey="signinMethodSplit" />
            <TopList metricKey="onboardingFinishStep" />
            <Donut metricKey="secondWeekReturn" />
          </div>
        </Section>

        <Section title="Engagemang i perioden" intro={eventsIntro}>
          <MetricGrid>
            <MetricTile metricKey="providerClicks" />
            <MetricTile metricKey="shareClicks" />
            <MetricTile metricKey="priceCheckTotals" />
            <MetricTile metricKey="priceCheckSaves" />
          </MetricGrid>
          <div className="grid lg:grid-cols-2 gap-3 mt-3">
            <TimeSeriesChart metricKey="titlesAddedTrend" />
            <Donut metricKey="providerClicksByType" />
            <Donut metricKey="shareClicksBySurface" />
            <Donut metricKey="shareClicksByMethod" />
            <Donut metricKey="priceCheckBySurface" />
            <TopList metricKey="advisorActions" />
          </div>
        </Section>

        <Section title="Biblioteket" intro="Allt som ligger i användarnas bibliotek just nu. Följer inte datumväljaren.">
          <div className="grid lg:grid-cols-2 gap-3">
            <Donut metricKey="statusDistribution" />
            <Donut metricKey="mediaTypeSplit" />
            <Histogram metricKey="ratingsHistogram" />
            <TopList metricKey="topTitles" />
            <TopList metricKey="topProviders" />
            <TopList metricKey="topGenres" />
          </div>
        </Section>

        <Section title="Fråga Binge i perioden">
          <MetricGrid>
            <MetricTile metricKey="askSearches" />
            <MetricTile metricKey="askZeroRate" />
            <MetricTile metricKey="askLowConfidenceRate" />
          </MetricGrid>
          <div className="grid lg:grid-cols-2 gap-3 mt-3">
            <Donut metricKey="askResultBuckets" />
            <TopList metricKey="askStrandingFilters" />
            <TopList metricKey="askRemovedChips" />
          </div>
        </Section>

        <Section title="Besök">
          <p className={cardClass('p-3 text-sm text-ink-2')}>
            Besök, sidvisningar och varifrån folk kommer mäts inte — Binge sätter inga cookies.
          </p>
        </Section>

        {/* ExplainDrawer self-renders from the ?metric URL param */}
        <ExplainDrawer />
      </div>
    </InsightsProvider>
  );
}
