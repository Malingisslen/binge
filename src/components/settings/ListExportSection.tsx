'use client';

import { Download } from 'lucide-react';
import { useWatchlist } from '@/hooks/useWatchlist';
import { SettingsSection } from './SettingsSection';
import { Button } from '@/components/ui/Button';
import { buildLetterboxdCsv, buildTraktExport } from '@/lib/export/exportLists';

function download(filename: string, mime: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function ListExportSection() {
  const { items, libraryKnown } = useWatchlist();
  // Samma spärr som importen: ett ännu inte läst bibliotek skulle ge en tom fil.
  const disabled = !libraryKnown;
  const shows = items.filter(i => i.mediaType === 'tv').length;
  return (
    <SettingsSection title="Flytta ut dina listor">
      <p className="text-xs text-ink-3 mb-2">
        Ladda ner dina sedda titlar och din vill-se-lista för att ta med dem till Letterboxd
        (CSV, bara filmer) eller Trakt (JSON, filmer och serier). Filerna skapas på din enhet.
      </p>
      {shows > 0 && (
        <p className="text-xs text-ink-3 mb-2">
          {shows} serier i ditt bibliotek ingår inte i Letterboxd-filerna, eftersom Letterboxd bara hanterar filmer.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" disabled={disabled} className="disabled:opacity-50"
          onClick={() => download('binge-letterboxd-sedda.csv', 'text/csv', buildLetterboxdCsv(items, 'watched'))}>
          <Download size={11} /> Letterboxd: sedda
        </Button>
        <Button variant="ghost" size="sm" disabled={disabled} className="disabled:opacity-50"
          onClick={() => download('binge-letterboxd-vill-se.csv', 'text/csv', buildLetterboxdCsv(items, 'watchlist'))}>
          <Download size={11} /> Letterboxd: vill se
        </Button>
        <Button variant="ghost" size="sm" disabled={disabled} className="disabled:opacity-50"
          onClick={() => download('binge-trakt.json', 'application/json', JSON.stringify(buildTraktExport(items), null, 2))}>
          <Download size={11} /> Trakt (JSON)
        </Button>
      </div>
    </SettingsSection>
  );
}
