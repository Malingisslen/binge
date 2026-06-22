/**
 * BIN-69 — TMDB-matchning för CSV-import. Ren scoring (testbar); själva
 * sökningen sker i UI-lagret via searchMulti. Medvetet KONSERVATIV: en dålig
 * matchning korrupterar biblioteket, så tröskeln kräver antingen exakt
 * titelmatch eller substring + exakt årtal. Osäkert → ingen match (raden
 * hamnar som "ej matchad" i dry-run istället för att gissa fel).
 */

import type { TMDBSearchResult } from '@/types';
import type { WatchStatus, MediaType } from '@/types';
import type { ImportRow } from './parseWatchlistCsv';

export function titleOf(r: TMDBSearchResult): string {
  return r.title || r.name || '';
}

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function yearOf(r: TMDBSearchResult): number | null {
  const d = r.release_date || r.first_air_date || '';
  const y = parseInt(d.slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

/** Högre = bättre. 0 = diskvalificerad (fel media-typ eller ingen titelöverlapp). */
export function scoreCandidate(row: ImportRow, c: TMDBSearchResult): number {
  if (c.media_type !== 'movie' && c.media_type !== 'tv') return 0;
  const rt = normalize(row.title);
  const ct = normalize(titleOf(c));
  if (!rt || !ct) return 0;

  let score: number;
  if (rt === ct) {
    score = 1.0;
  } else if (ct.includes(rt) || rt.includes(ct)) {
    // BIN-144: substring-kredit BARA när den kortare titeln är en betydande
    // andel av den längre. Annars matchar en kort rad-titel ("Up", "Her", "It")
    // varje längre samma-års-titel ("Up in the Air") → 0.5 + 0.5 exakt år = 1.0
    // = fel film importerad. Kräv ratio > 0.5 (kortare måste vara mer än halva
    // den längre) så delsträng+år ensamt inte klarar tröskeln; korta titlar
    // tvingas till exakt match.
    const ratio = Math.min(rt.length, ct.length) / Math.max(rt.length, ct.length);
    if (ratio <= 0.5) return 0;
    score = 0.5;
  } else {
    return 0; // måste åtminstone substring-matcha
  }

  const cy = yearOf(c);
  if (row.year != null && cy != null) {
    const diff = Math.abs(row.year - cy);
    if (diff === 0) score += 0.5;
    else if (diff === 1) score += 0.2;
    else score -= 0.3; // fel årtal drar ner — olika filmer med samma titel
  }

  if (row.mediaTypeHint && row.mediaTypeHint === c.media_type) score += 0.3;
  // Liten popularitets-tiebreak så "Dune (2021)" slår en obskyr namne.
  score += Math.min((c.vote_count ?? 0) / 100000, 0.1);
  return score;
}

export const MATCH_THRESHOLD = 1.0;

export function pickBestMatch(
  row: ImportRow,
  candidates: TMDBSearchResult[],
  threshold = MATCH_THRESHOLD,
): TMDBSearchResult | null {
  let best: TMDBSearchResult | null = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const s = scoreCandidate(row, c);
    if (s > bestScore) { bestScore = s; best = c; }
  }
  return best && bestScore >= threshold ? best : null;
}

/**
 * Avbildar en importrad → Binge-status enligt TV-aware-schemat:
 *  - TV → alltid 'mina' (serier har inget 'sedd'-slutläge).
 *  - Film med betyg (watched/ratings-export) → 'sedd'; utan betyg (watchlist) → 'vill_se'.
 */
export function importStatus(row: ImportRow, mediaType: MediaType): WatchStatus {
  if (mediaType === 'tv') return 'mina';
  return row.rating != null ? 'sedd' : 'vill_se';
}
