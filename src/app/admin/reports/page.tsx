'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AuthGuard from '@/components/AuthGuard';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/contexts/ToastContext';
import {
  listReports,
  updateReportStatus,
  REPORT_REASON_LABELS,
  REPORT_STATUS_LABELS,
  type Report,
  type ReportStatus,
} from '@/lib/firebase/reports';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoadingView } from '@/components/ui/LoadingView';

const STATUS_TABS: ReportStatus[] = ['open', 'reviewed', 'actioned', 'dismissed'];

export default function AdminReportsPage() {
  return (
    <AuthGuard>
      <AdminGate>
        <ReportsDashboard />
      </AdminGate>
    </AuthGuard>
  );
}

/**
 * Client-side gate — renderar 403 om user.isAdmin !== true. Firestore-
 * reglerna enforce:ar samma sak mot servern; denna gate är bara för UX.
 */
function AdminGate({ children }: { children: React.ReactNode }) {
  const { user, loading, profileLoading } = useAuth();
  if (loading || profileLoading) return <LoadingView label="Laddar…" />;
  if (!user?.isAdmin) {
    return (
      <div className="max-w-[480px]">
        <PageHeader title="Åtkomst nekad" />
        <p className="text-xs text-text-muted">
          Den här sidan är bara för administratörer. Om du tror att detta är fel,
          kontakta <a href="mailto:hej@binge.nu" className="text-accent">hej@binge.nu</a>.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

function ReportsDashboard() {
  const { uid } = useAuth(); // only rendered inside AdminGate → an authed admin
  const { show: toast } = useToast();
  const [activeTab, setActiveTab] = useState<ReportStatus>('open');
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (status: ReportStatus) => {
    setLoading(true);
    setError(null);
    try {
      const data = await listReports({ status });
      setReports(data);
    } catch (err) {

      console.error('[admin/reports]', err);
      setError('Kunde inte ladda rapporter. Kontrollera att du har admin-rättigheter.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(activeTab);
  }, [activeTab]);

  const handleAction = async (reportId: string, newStatus: ReportStatus) => {
    if (!uid) return; // admin UI only renders for an authed admin; guard for the audit uid
    try {
      await updateReportStatus(reportId, newStatus, uid);
      toast(`Rapport markerad som ${REPORT_STATUS_LABELS[newStatus].toLowerCase()}`);
      void load(activeTab);
    } catch {
      toast('Kunde inte uppdatera rapporten.');
    }
  };

  return (
    <div>
      <PageHeader crumb="Admin · Rapporter" title="Rapporter" />

      <div className="flex gap-[1px] mb-3">
        {STATUS_TABS.map(s => (
          <button
            key={s}
            onClick={() => setActiveTab(s)}
            className={`px-3 py-[4px] text-xs rounded-sm cursor-pointer ${
              activeTab === s ? 'bg-accent text-white' : 'bg-surface text-text-secondary hover:bg-surface-hover'
            }`}
          >
            {REPORT_STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {error && (
        <div className="px-3 py-2 text-xs text-danger-ink bg-danger-soft border border-danger/30 rounded-sm mb-3">
          {error}
        </div>
      )}

      {loading && (
        <LoadingView label="Laddar…" />
      )}

      {!loading && reports.length === 0 && !error && (
        <div className="bg-surface border border-border-main rounded-sm px-3 py-6 text-center text-sm text-text-muted">
          Inga {REPORT_STATUS_LABELS[activeTab].toLowerCase()} rapporter.
        </div>
      )}

      <ul className="space-y-2">
        {reports.map(r => (
          <ReportRow key={r.id} report={r} onAction={handleAction} />
        ))}
      </ul>

      <div className="mt-4 text-xxs text-text-muted">
        Se <Link href="https://github.com/Malingisslen/binge/blob/main/docs/moderation.md" className="text-accent underline" target="_blank">docs/moderation.md</Link> för beslutsträd per rapport-typ.
      </div>
    </div>
  );
}

function ReportRow({
  report, onAction,
}: {
  report: Report;
  onAction: (id: string, status: ReportStatus) => void;
}) {
  const targetLink = buildTargetLink(report);

  return (
    <li className="bg-surface border border-border-main rounded-sm p-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-text-muted mb-1">
            {report.createdAt.toLocaleString('sv-SE')}
          </div>
          <div className="text-sm font-semibold text-text-primary">
            {REPORT_REASON_LABELS[report.reason]}
            <span className="text-text-muted font-normal ml-2">
              · {report.targetType} · {report.targetId}
            </span>
          </div>
          {report.note && (
            <div className="text-xs text-text-secondary mt-1 px-2 py-1 bg-page rounded-sm">
              &ldquo;{report.note}&rdquo;
            </div>
          )}
          <div className="text-xxs text-text-muted mt-1">
            Rapporterad av {report.reporterUid.slice(0, 8)} •
            Target ägare: {report.targetOwnerUid.slice(0, 8)}
            {report.actionedByUid && <> • Åtgärdad av {report.actionedByUid.slice(0, 8)}</>}
          </div>
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          {targetLink && (
            <Link
              href={targetLink}
              target="_blank"
              className="px-3 py-[3px] text-xs text-accent no-underline hover:underline text-right"
            >
              Öppna target →
            </Link>
          )}
          {report.status === 'open' && (
            <>
              <button
                onClick={() => onAction(report.id, 'reviewed')}
                className="px-3 py-[3px] text-xs border border-border-main rounded-sm bg-white cursor-pointer hover:bg-surface-hover"
              >
                Granskad
              </button>
              <button
                onClick={() => onAction(report.id, 'actioned')}
                className="px-3 py-[3px] text-xs bg-accent text-white border-none rounded-sm cursor-pointer"
              >
                Åtgärda
              </button>
              <button
                onClick={() => onAction(report.id, 'dismissed')}
                className="px-3 py-[3px] text-xs border border-border-main rounded-sm bg-white text-text-muted cursor-pointer hover:bg-surface-hover"
              >
                Avfärda
              </button>
            </>
          )}
          {report.status !== 'open' && (
            <>
              <span className="px-3 py-[3px] text-xxs text-text-muted text-right">
                {REPORT_STATUS_LABELS[report.status]}
              </span>
              <button
                onClick={() => onAction(report.id, 'open')}
                className="px-3 py-[3px] text-xs border border-border-main rounded-sm bg-white cursor-pointer hover:bg-surface-hover"
              >
                Öppna igen
              </button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * Bygger en länk till det rapporterade innehållet där det är rimligt att
 * öppna direkt. Kommentarer rapporteras via `reviews/{id}/comments/{id}`-
 * path — vi länkar till parent-recensionens titel-sida.
 */
function buildTargetLink(report: Report): string | null {
  switch (report.targetType) {
    case 'user':
      return `/user/${report.targetOwnerUid}`;
    case 'list':
      return `/list/${report.targetId}`;
    case 'review':
      // Vi har inte titel-id i rapporten — admin kan söka i Firestore-console
      // på reviewId. Ingen direktlänk.
      return null;
    case 'comment':
      return null;
    default:
      return null;
  }
}
