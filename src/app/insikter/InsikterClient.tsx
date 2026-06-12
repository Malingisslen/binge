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
import {
  Toolbar, MetricGrid, MetricTile, TimeSeriesChart, Donut, Funnel,
  Histogram, TopList, ExplainDrawer,
} from './components';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-3 mb-2">{title}</h2>
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

  const { data, loading, error, lastFetchedAt, isFirstLoad } = useInsightsData(getToken, range);

  const header = (
    <PageHeader
      crumb="Insikter · internt"
      title="Insikter"
      standfirst="Internt analysverktyg — inte länkat i menyn och inte indexerat."
    />
  );

  // ── Access / loading / error gates ─────────────────────────────────────────
  if (authLoading || profileLoading) {
    return <div className="canvas">{header}<LoadingView label="Kontrollerar behörighet…" /></div>;
  }

  if (!hasAccess) {
    return (
      <div className="canvas">
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
    return <div className="canvas">{header}<LoadingView label="Laddar insikter…" variant="detail" /></div>;
  }

  if (error && !data) {
    return (
      <div className="canvas">
        {header}
        <div className="mt-6">
          <EmptyState
            title="Kunde inte ladda insikter"
            body={error}
            action={
              <button type="button" onClick={() => window.location.reload()} className="btn btn-acc">
                Försök igen
              </button>
            }
          />
        </div>
      </div>
    );
  }

  if (!data) {
    return <div className="canvas">{header}<LoadingView label="Ingen data ännu." /></div>;
  }

  // ── Dashboard ───────────────────────────────────────────────────────────────
  return (
    <InsightsProvider value={data}>
      <div className={`canvas ${loading ? 'opacity-70 transition-opacity' : ''}`}>
        {header}

        {(error || data.partial) && (
          <div className="mt-3 rounded-md border border-danger bg-danger-soft text-danger-ink px-3 py-2 text-sm" role="alert">
            {error
              ? <>{error} — <button type="button" onClick={() => window.location.reload()} className="underline">Försök igen</button></>
              : 'Visar delvis data — någon datakälla var otillgänglig (t.ex. Plausible eller rollupen har inte körts än).'}
          </div>
        )}

        <div className="mt-4">
          <Toolbar lastFetchedAt={lastFetchedAt} />
        </div>

        <Section title="Översikt">
          <MetricGrid>
            <MetricTile metricKey="totalUsers" />
            <MetricTile metricKey="newUsers" />
            <MetricTile metricKey="activeVisitors" />
            <MetricTile metricKey="totalTitlesTracked" />
            <MetricTile metricKey="totalReviews" />
            <MetricTile metricKey="titlesAdded" />
          </MetricGrid>
        </Section>

        <Section title="Tillväxt">
          <div className="grid lg:grid-cols-2 gap-3">
            <TimeSeriesChart metricKey="signupsTrend" />
            <Funnel metricKey="onboardingFunnel" />
            <Donut metricKey="signinMethodSplit" />
            <div className="self-start">
              <MetricGrid>
                <MetricTile metricKey="donateClicks" />
              </MetricGrid>
            </div>
          </div>
        </Section>

        <Section title="Produktanvändning">
          <div className="grid lg:grid-cols-2 gap-3">
            <Donut metricKey="statusDistribution" />
            <Donut metricKey="mediaTypeSplit" />
            <Histogram metricKey="ratingsHistogram" />
            <TopList metricKey="topTitles" />
            <TopList metricKey="topProviders" />
            <TopList metricKey="topGenres" />
          </div>
          <div className="mt-3">
            <MetricGrid>
              <MetricTile metricKey="advisorPauses" />
              <MetricTile metricKey="activeSessions" />
              <MetricTile metricKey="groupsCount" />
            </MetricGrid>
          </div>
        </Section>

        <Section title="Trafik">
          <MetricGrid>
            <MetricTile metricKey="pageViews" />
            <MetricTile metricKey="visitors" />
            <MetricTile metricKey="avgSessionDuration" />
          </MetricGrid>
          <div className="grid lg:grid-cols-2 gap-3 mt-3">
            <TopList metricKey="topPages" />
            <TopList metricKey="topReferrers" />
          </div>
        </Section>

        {/* ExplainDrawer self-renders from the ?metric URL param */}
        <ExplainDrawer />
      </div>
    </InsightsProvider>
  );
}
