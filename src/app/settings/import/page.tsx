'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import AuthGuard from '@/components/AuthGuard';
import { PageHeader } from '@/components/layout/PageHeader';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useToast } from '@/contexts/ToastContext';
import { searchMulti, findByImdbId, posterUrl } from '@/lib/tmdb/client';
import { parseWatchlistCsv, type ImportRow, type ImportFormat } from '@/lib/import/parseWatchlistCsv';
import { pickBestMatch, titleOf, importStatus } from '@/lib/import/matchTitle';
import { buildWatchlistAddPayload } from '@/lib/watchlist/buildAddPayload';
import {
  LIBRARY_UNREACHABLE_TITLE,
  LIBRARY_UNREACHABLE_BODY,
  LIBRARY_RETRY_LABEL,
  LIBRARY_LOADING,
  LIBRARY_WRITE_HELD,
} from '@/lib/watchlist/libraryHoldCopy';
import type { MediaType, WatchStatus } from '@/types';

/**
 * BIN-69 — CSV-import (Letterboxd / IMDb). Dry-run-säkerhet är bärande: vi
 * skriver INGENTING förrän användaren bekräftat den matchade listan. Matchning
 * är konservativ (se matchTitle.ts) så fel-matchningar hellre hamnar som "ej
 * matchad" än korrumperar biblioteket.
 */

const MAX_ROWS = 1000; // bound TMDB-sök-fan-out per import (semaforen strypar ändå)

interface Analyzed {
  row: ImportRow;
  match: { tmdbId: number; mediaType: MediaType; title: string; posterPath: string | null; year: number | null; genreIds: number[] } | null;
  duplicate: boolean;
  status: WatchStatus | null;
}

type Stage = 'idle' | 'parsed' | 'analyzing' | 'analyzed' | 'importing' | 'done';

export default function ImportPage() {
  return <AuthGuard><ImportContent /></AuthGuard>;
}

function ImportContent() {
  usePageMeta({ title: 'Importera' });
  // BIN-729: `libraryKnown` (snapshotSettled && !listenerFailed), never
  // `loading` — which goes false in BOTH terminal states. On a dead listener
  // `getItem` answers null for EVERY title, so every row below reads as a
  // non-duplicate and `addItem` hard-writes `status` over titles the user
  // already has, row after row. `status` is the one field no payload shape can
  // protect (see MoviePageClient's handleBevaka comment), so this gate is the
  // only defence — the same argument, and the same one-line fix, as
  // CollectionSection's bulk "Lägg alla osedda i vill se" (BIN-596).
  //
  // `listenerFailed` is read on its own too, because the two halves of "not
  // known" call for different UI: the first snapshot lands on its own in under a
  // second, while a failed listener never does and needs a way out.
  const { getItem, addItem, libraryKnown, listenerFailed, retryListener } = useWatchlist();
  const { show: toast } = useToast();

  const [stage, setStage] = useState<Stage>('idle');
  const [format, setFormat] = useState<ImportFormat>('unknown');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [truncated, setTruncated] = useState(0);
  const [analyzed, setAnalyzed] = useState<Analyzed[]>([]);
  const [imported, setImported] = useState(0);
  const [importFailed, setImportFailed] = useState(0);

  const onFile = useCallback(async (file: File) => {
    const text = await file.text();
    const res = parseWatchlistCsv(text);
    setFormat(res.format);
    setSkipped(res.skipped);
    const capped = res.rows.slice(0, MAX_ROWS);
    setTruncated(res.rows.length - capped.length);
    setRows(capped);
    setAnalyzed([]);
    setImported(0);
    setImportFailed(0);
    setStage(res.format === 'unknown' ? 'idle' : 'parsed');
  }, []);

  const analyze = useCallback(async () => {
    // Gated as well as the import itself: the dry-run's `duplicate` verdict IS
    // the dedup, and one computed against an unread library marks every row as
    // new. The user then confirms a list that is wrong, and the confirmation is
    // what the whole page treats as consent to write.
    if (!libraryKnown) return;
    setStage('analyzing');
    const results = await Promise.all(rows.map(async (row): Promise<Analyzed> => {
      try {
        // BIN-144: bär raden ett IMDb-id (IMDb-export) → exakt match via /find,
        // ingen fuzzy-sök. Faller tillbaka till titel-sök bara om id:t inte ger
        // träff (sällsynt). Ger IMDb-export den mest exakta matchningen.
        let best = row.imdbId ? await findByImdbId(row.imdbId) : null;
        if (!best) {
          const res = await searchMulti(row.title);
          best = pickBestMatch(row, res.results ?? []);
        }
        if (!best || (best.media_type !== 'movie' && best.media_type !== 'tv')) {
          return { row, match: null, duplicate: false, status: null };
        }
        const mediaType = best.media_type as MediaType;
        const duplicate = !!getItem(mediaType, best.id);
        const date = best.release_date || best.first_air_date || '';
        return {
          row,
          match: {
            tmdbId: best.id,
            mediaType,
            title: titleOf(best),
            posterPath: best.poster_path,
            year: date ? parseInt(date.slice(0, 4), 10) || null : null,
            genreIds: best.genre_ids ?? [],
          },
          duplicate,
          status: importStatus(row, mediaType),
        };
      } catch {
        return { row, match: null, duplicate: false, status: null };
      }
    }));
    setAnalyzed(results);
    setStage('analyzed');
  }, [rows, getItem, libraryKnown]);

  const importable = analyzed.filter(a => a.match && !a.duplicate && a.status);

  const runImport = useCallback(async () => {
    // Belt-and-braces behind the disabled button: the analysis this loop writes
    // from could have been produced before the listener died, and this is a
    // bulk hard-write of `status` — the most destructive path in the app after
    // CollectionSection's bulk add.
    if (!libraryKnown) return;
    setStage('importing');
    let n = 0;
    let failed = 0;
    for (const a of importable) {
      if (!a.match || !a.status) continue;
      // BIN-150: per-titel try/catch — en misslyckad skrivning (offline/regel)
      // får inte avbryta resten eller sväljas tyst. Räkna + visa misslyckade.
      try {
        await addItem(buildWatchlistAddPayload({
          tmdbId: a.match.tmdbId,
          mediaType: a.match.mediaType,
          status: a.status,
          title: a.match.title,
          posterPath: a.match.posterPath,
          releaseYear: a.match.year,
          rating: a.row.rating,
          genreIds: a.match.genreIds,
          // New add from a CSV row — no provider data here. Explicit [] keeps the
          // created doc's array contract intact (see OnboardingFlow for the rule).
          providers: [],
        }));
        n++;
        setImported(n);
      } catch {
        failed++;
        setImportFailed(failed);
      }
    }
    setStage('done');
    toast(failed > 0 ? `Importerade ${n} titlar · ${failed} misslyckades` : `Importerade ${n} titlar`);
  }, [importable, addItem, toast, libraryKnown]);

  const matchedCount = analyzed.filter(a => a.match).length;
  const dupeCount = analyzed.filter(a => a.match && a.duplicate).length;
  const unmatchedCount = analyzed.filter(a => !a.match).length;

  return (
    <>
      <PageHeader
        crumb={<Link href="/settings/" style={{ color: 'inherit' }}>Inställningar</Link>}
        title="Importera"
        standfirst="Ta med din historik från Letterboxd eller IMDb. Vi visar exakt vad som importeras innan något sparas."
      />

      <div className="mt-7 max-w-2xl">
        <div className="bg-surface border border-rule rounded-md p-4">
          <p className="text-sm text-ink-2 mb-3">
            Exportera en CSV från <strong>Letterboxd</strong> (Inställningar → Import &amp; Export) eller{' '}
            <strong>IMDb</strong> (din lista → Export) och välj filen här.
          </p>
          <input
            type="file"
            accept=".csv,text/csv"
            // Picking a file writes nothing, so it stays usable while the
            // library loads — the hold belongs on the two actions that write.
            disabled={stage === 'analyzing' || stage === 'importing'}
            onChange={e => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
            className="text-sm disabled:opacity-50"
          />
          {stage !== 'idle' && format !== 'unknown' && (
            <p className="text-xs text-ink-3 mt-2">
              Igenkänt format: <strong>{format === 'letterboxd' ? 'Letterboxd' : 'IMDb'}</strong> · {rows.length} rader
              {skipped > 0 && ` · ${skipped} hoppade över (saknar titel)`}
              {truncated > 0 && ` · ${truncated} utöver max ${MAX_ROWS} ignorerade`}
            </p>
          )}
          {stage === 'idle' && format === 'unknown' && rows.length === 0 && (
            <p className="text-xs text-ink-3 mt-2">Välj en CSV-fil för att börja.</p>
          )}
        </div>

        {/* BIN-729 — the honest hold. Rendered above the actions so a disabled
            "Analysera"/"Importera" is never an unexplained dead button, and split
            in two because the failed half never resolves on its own: it gets a
            retry, the transient half gets a sentence. */}
        {!libraryKnown && (
          listenerFailed ? (
            <div
              role="alert"
              className="mt-4 bg-danger-soft border border-danger/30 rounded-md px-4 py-3"
            >
              <p className="text-sm font-semibold text-danger-ink">{LIBRARY_UNREACHABLE_TITLE}</p>
              <p className="text-sm text-ink-2 mt-1">{LIBRARY_UNREACHABLE_BODY}</p>
              <p className="text-xs text-ink-3 mt-1">{LIBRARY_WRITE_HELD}</p>
              <button type="button" onClick={retryListener} className="btn btn-acc mt-3">
                {LIBRARY_RETRY_LABEL}
              </button>
            </div>
          ) : (
            <p className="text-sm text-ink-3 mt-4">{LIBRARY_LOADING}</p>
          )
        )}

        {stage === 'parsed' && (
          <button onClick={analyze} disabled={!libraryKnown} className="btn btn-acc mt-4 disabled:opacity-50">
            Analysera mot TMDB
          </button>
        )}
        {stage === 'analyzing' && (
          <p className="text-sm text-ink-3 mt-4">Matchar {rows.length} titlar mot TMDB…</p>
        )}

        {(stage === 'analyzed' || stage === 'importing' || stage === 'done') && (
          <div className="mt-5">
            <div className="flex gap-4 text-sm mb-3">
              <span><strong>{matchedCount - dupeCount}</strong> att importera</span>
              <span className="text-ink-3"><strong>{dupeCount}</strong> redan i biblioteket</span>
              <span className="text-ink-3"><strong>{unmatchedCount}</strong> ej matchade</span>
            </div>

            {stage === 'analyzed' && importable.length > 0 && (
              <button onClick={runImport} disabled={!libraryKnown} className="btn btn-acc mb-4 disabled:opacity-50">
                Importera {importable.length} titlar
              </button>
            )}
            {stage === 'importing' && (
              <p className="text-sm text-ink-3 mb-4">Importerar… {imported}/{importable.length}</p>
            )}
            {stage === 'done' && (
              <p className="text-sm text-acc-deep mb-4">
                Klart — {imported} titlar importerade.
                {importFailed > 0 && <span className="text-danger-ink"> {importFailed} misslyckades — försök igen.</span>}
              </p>
            )}

            {unmatchedCount > 0 && (
              <details className="mt-2">
                <summary className="text-xs font-bold uppercase tracking-[0.5px] text-ink-3 cursor-pointer">
                  Ej matchade ({unmatchedCount}) ›
                </summary>
                <ul className="mt-2 text-sm text-ink-2 list-disc pl-5">
                  {analyzed.filter(a => !a.match).map((a, i) => (
                    <li key={i}>{a.row.title}{a.row.year ? ` (${a.row.year})` : ''}</li>
                  ))}
                </ul>
              </details>
            )}

            {matchedCount > 0 && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {analyzed.filter(a => a.match).map((a, i) => (
                  <div key={i} className={`flex items-center gap-2 text-sm ${a.duplicate ? 'opacity-50' : ''}`}>
                    {posterUrl(a.match!.posterPath, 'w92') ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={posterUrl(a.match!.posterPath, 'w92')!} alt="" width={28} height={42}
                        loading="lazy" decoding="async" style={{ borderRadius: 3, border: '1px solid var(--rule)' }} />
                    ) : <div style={{ width: 28, height: 42, background: 'var(--placeholder-fill)', borderRadius: 3 }} />}
                    <span className="min-w-0">
                      <span className="block truncate">{a.match!.title}</span>
                      <span className="text-xs text-ink-3">
                        {a.duplicate ? 'redan i biblioteket' : a.status === 'sedd' ? 'sedd' : a.status === 'mina' ? 'serie' : 'vill se'}
                        {a.row.rating != null && !a.duplicate ? ` · ${a.row.rating * 2}/10` : ''}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
