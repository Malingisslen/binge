'use client';

// BIN-176 — "Fråga Binge": natural-language, streaming-aware search.
// Deterministic-first: the sentence is parsed by rules (parseSearch) into an
// AskFilter, shown back as removable chips (so the user sees + can correct the
// interpretation), then mapped to TMDB discover queries. No LLM in this path — an
// LLM fallback for low-confidence parses is a later addition (see the plan).

import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { discoverMovies, discoverTV, isAddableMediaType } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { dedupeAndExclude, scorePopularity } from '@/lib/recommendations/rowComposition';
import { parseSearch, isLowConfidence } from '@/lib/askBinge/parseSearch';
import { askFilterToDiscoverParams, describeFilter } from '@/lib/askBinge/toDiscoverParams';
import type { AskFilter } from '@/lib/askBinge/types';
import { useAuth } from '@/hooks/useAuth';
import { useWatchlist } from '@/contexts/WatchlistContext';
import { useNotInterested } from '@/contexts/NotInterestedContext';
import { PageHeader } from '@/components/layout/PageHeader';
import TitleGrid from '@/components/title/TitleGrid';
import { LoadingView } from '@/components/ui/LoadingView';
import { EmptyState } from '@/components/ui/EmptyState';
import JustWatchCredit from '@/components/ui/JustWatchCredit';
import { trackEvent } from '@/lib/analytics';
import type { RowTitle, TMDBSearchResult } from '@/types';

const EXAMPLES = [
  'mysig komedi under 90 min',
  'hyllad svensk deckare jag inte sett',
  'skräckfilm från 80-talet',
  'sci-fi-serie på mina tjänster',
];

const EMPTY_SET: ReadonlySet<number> = new Set();
const VISIBLE_CAP = 60;

export default function AskPage() {
  const { user } = useAuth();
  const myProviders = useMemo(() => user?.myProviders ?? [], [user?.myProviders]);
  const { items: watchlist } = useWatchlist();
  const { items: notInterested } = useNotInterested();

  const [input, setInput] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [filter, setFilter] = useState<AskFilter>({});

  function runSearch(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const parsed = parseSearch(trimmed);
    setInput(trimmed);
    setSubmitted(trimmed);
    setFilter(parsed);
    trackEvent('ask_binge_submitted', { fields: Object.keys(parsed).length });
  }

  function removeChip(key: keyof AskFilter) {
    setFilter((f) => {
      const next = { ...f };
      delete next[key];
      return next;
    });
  }

  const hasQuery = submitted.trim().length > 0;
  const lowConfidence = hasQuery && isLowConfidence(filter);
  // Don't spend TMDB discover quota on a parse that yielded nothing — the
  // low-confidence branch shows a help state instead of results.
  const canQuery = hasQuery && !lowConfidence;
  const plan = useMemo(() => askFilterToDiscoverParams(filter, { myProviders }), [filter, myProviders]);
  const chips = useMemo(() => describeFilter(filter), [filter]);

  // Titles the user has already seen / started / dropped / hidden — only used when
  // the query asked to exclude them.
  const excludedIds = useMemo(() => {
    const s = new Set<number>();
    for (const it of watchlist) {
      if (it.status === 'sedd' || it.status === 'avbruten') s.add(it.tmdbId);
      else if (it.mediaType === 'tv' && it.status === 'mina' && it.lastWatchedSeason != null) s.add(it.tmdbId);
    }
    for (const n of notInterested) s.add(n.tmdbId);
    return s;
  }, [watchlist, notInterested]);

  const mKey = JSON.stringify(plan.movieParams);
  const tKey = JSON.stringify(plan.tvParams);

  const queries = useQueries({
    queries: [
      { queryKey: ['ask-movie', mKey, 1], queryFn: ({ signal }: { signal?: AbortSignal }) => discoverMovies({ ...plan.movieParams }, { signal }), staleTime: TMDB_STALE.DISCOVER, enabled: canQuery && plan.wantMovies },
      { queryKey: ['ask-movie', mKey, 2], queryFn: ({ signal }: { signal?: AbortSignal }) => discoverMovies({ ...plan.movieParams, page: '2' }, { signal }), staleTime: TMDB_STALE.DISCOVER, enabled: canQuery && plan.wantMovies },
      { queryKey: ['ask-tv', tKey, 1], queryFn: ({ signal }: { signal?: AbortSignal }) => discoverTV({ ...plan.tvParams }, { signal }), staleTime: TMDB_STALE.DISCOVER, enabled: canQuery && plan.wantTV },
      { queryKey: ['ask-tv', tKey, 2], queryFn: ({ signal }: { signal?: AbortSignal }) => discoverTV({ ...plan.tvParams, page: '2' }, { signal }), staleTime: TMDB_STALE.DISCOVER, enabled: canQuery && plan.wantTV },
    ],
  });

  const isLoading = hasQuery && queries.some((q) => q.isLoading);

  const results = useMemo(() => {
    const items: RowTitle[] = [];
    const push = (arr: TMDBSearchResult[] | undefined, media: 'movie' | 'tv') =>
      (arr ?? []).forEach((r) => items.push({ ...r, media_type: media }));
    push(queries[0]?.data?.results, 'movie');
    push(queries[1]?.data?.results, 'movie');
    push(queries[2]?.data?.results, 'tv');
    push(queries[3]?.data?.results, 'tv');
    const excl = filter.excludeSeen ? excludedIds : EMPTY_SET;
    const deduped = dedupeAndExclude(items, excl).filter(isAddableMediaType);
    deduped.sort((a, b) => scorePopularity(b) - scorePopularity(a));
    return deduped.slice(0, VISIBLE_CAP);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queries[0]?.data, queries[1]?.data, queries[2]?.data, queries[3]?.data, filter.excludeSeen, excludedIds]);

  return (
    <>
      <PageHeader
        crumb="Fråga Binge"
        title="Vad är du sugen på?"
        standfirst="Skriv i vanlig svenska — t.ex. ”mysig komedi under 90 min jag inte sett”. Binge tolkar meningen och filtrerar fram titlar."
      />

      <form
        onSubmit={(e) => { e.preventDefault(); runSearch(input); }}
        style={{ display: 'flex', gap: 8, marginTop: 20 }}
      >
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={15} className="text-ink-3" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Beskriv vad du vill se…"
            aria-label="Beskriv vad du vill se"
            className="w-full bg-surface border border-rule rounded text-ink"
            style={{ padding: '8px 10px 8px 30px', fontSize: 15 }}
          />
        </div>
        <button type="submit" className="btn btn-acc" style={{ whiteSpace: 'nowrap' }}>Sök</button>
      </form>

      {/* Examples — only before the first search */}
      {!hasQuery && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
          <span className="text-ink-3" style={{ fontSize: 12, alignSelf: 'center' }}>Prova:</span>
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" className="chip" onClick={() => runSearch(ex)}>{ex}</button>
          ))}
        </div>
      )}

      {/* Interpreted filter as removable chips */}
      {hasQuery && chips.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 14, alignItems: 'center' }}>
          <span className="text-ink-3" style={{ fontSize: 12 }}>Tolkning:</span>
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              className="chip acc"
              onClick={() => removeChip(c.key)}
              aria-label={`Ta bort filter: ${c.label}`}
              title="Ta bort"
              style={{ gap: 4 }}
            >
              {c.label}
              <X size={11} />
            </button>
          ))}
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        {!hasQuery ? (
          <EmptyState
            title="Fråga med egna ord"
            body="Beskriv genre, känsla, längd, tjänst eller årtionde — Binge översätter det till ett filter och visar bara det du kan spela upp."
          />
        ) : lowConfidence ? (
          <EmptyState
            title="Jag förstod inte riktigt"
            body="Prova att nämna en genre (deckare, komedi), en tjänst (Netflix), en längd (under 90 min) eller ett årtionde (80-talet)."
          />
        ) : isLoading ? (
          <LoadingView label="Letar fram titlar…" variant="grid" />
        ) : results.length === 0 ? (
          <EmptyState
            title="Inga träffar"
            body="Inget matchade alla filter. Ta bort ett filter ovan och prova igen."
          />
        ) : (
          <div className="bg-surface border border-rule rounded-sm">
            <TitleGrid items={results} />
            <div className="px-3 py-[6px] border-t border-rule-2">
              <JustWatchCredit />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
