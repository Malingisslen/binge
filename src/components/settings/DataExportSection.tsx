'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/contexts/ToastContext';
import { SettingsSection } from './SettingsSection';
import { captureError } from '@/lib/sentry';
import type { SkippedGroup } from '@/lib/firebase/dataExport';

const NAMED_GROUPS_SHOWN = 3;
const UNNAMED_GROUP = 'en grupp utan namn';

// BIN-1380 (Malin 2026-10-01): the wording and the name rule are her decisions.
// A group that failed in several fields is listed once.
export function incompleteExportNotice(skipped: readonly SkippedGroup[]): string {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const g of skipped) {
    if (seen.has(g.groupId)) continue;
    seen.add(g.groupId);
    names.push(g.groupName?.trim() ? g.groupName.trim() : UNNAMED_GROUP);
  }
  const shown = names.slice(0, NAMED_GROUPS_SHOWN);
  const rest = names.length - shown.length;
  const list = rest > 0
    ? `${shown.join(', ')} och ${rest} till`
    : shown.length > 1
      ? `${shown.slice(0, -1).join(', ')} och ${shown[shown.length - 1]}`
      : shown[0];
  return `Dataexport nedladdad, men den är inte komplett. Uppgifterna från ${list} gick inte att läsa. `
    + 'Försök exportera igen om en stund. Fungerar det inte nästa gång heller? Skriv till hej@binge.nu.';
}

export function DataExportSection() {
  const { uid } = useAuth();
  const { show: toast } = useToast();
  const [exporting, setExporting] = useState(false);
  // BIN-1380: an incomplete export is told in a line that stays until the next export,
  // not in a toast that disappears before it can be read.
  const [incomplete, setIncomplete] = useState<string | null>(null);

  const handleExport = async () => {
    if (!uid) return;
    setExporting(true);
    setIncomplete(null);
    try {
      // Dynamisk import — håller Firestore query-surface borta från
      // settings-bundle:n tills användaren faktiskt klickar.
      const { buildUserExport, downloadExport } = await import('@/lib/firebase/dataExport');
      const data = await buildUserExport(uid);
      downloadExport(data);
      if (data.skippedGroups.length > 0) {
        setIncomplete(incompleteExportNotice(data.skippedGroups));
      } else {
        toast('Dataexport nedladdad.');
      }
    } catch (err) {
      console.error('[data-export]', err);
      // BIN-1394: a whole export failing reaches Sentry under its own kind. No `extra`:
      // it would carry no id, name or path. Monitoring must not stand between the user
      // and the toast (BIN-1166).
      try {
        captureError(err, { scope: 'dataExport', kind: 'dataExport-exportFailed' });
      } catch {
        // best effort
      }
      toast('Kunde inte skapa exporten. Försök igen.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <SettingsSection title="Exportera min data">
      <p className="text-xs text-ink-3 mb-2">
        Ladda ner all data om dig som en JSON-fil (GDPR artikel 20). Innehåller profil,
        bibliotek, betyg, progress, recensioner, listor och sociala kopplingar.
      </p>
      <button
        onClick={handleExport}
        disabled={exporting || !uid}
        className="btn btn-ghost btn-sm disabled:opacity-50"
      >
        <Download size={11} />
        {exporting ? 'Förbereder…' : 'Ladda ner mina data'}
      </button>
      {incomplete && (
        <p role="status" className="text-xs text-danger-ink mt-2">
          {incomplete}
        </p>
      )}
    </SettingsSection>
  );
}
