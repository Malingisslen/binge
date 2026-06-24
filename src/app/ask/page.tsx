'use client';

// BIN-176 — "Fråga Binge": natural-language, streaming-aware search.
// Deterministic-first: the sentence is parsed by rules (parseSearch) into an
// AskFilter, shown back as removable chips (so the user sees + can correct the
// interpretation), then mapped to TMDB discover queries. When the rules extract
// nothing (fuzzy residual), an LLM fallback (askBingeParse) interprets it — for
// logged-in users only, and degrading silently to the help state if unavailable.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQueries } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { discoverMovies, discoverTV, isAddableMediaType } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { dedupeAndExclude } from '@/lib/recommendations/rowComposition';
import { parseSearch, isLowConfidence } from '@/lib/askBinge/parseSearch';
import { rankAskResults } from '@/lib/askBinge/rankResults';
import { resultBucket, activeFilterSummary, mediaFilterOf } from '@/lib/askBinge/telemetry';
import { recordAskBinge } from '@/lib/askBinge/record';
import { llmParseFallback } from '@/lib/askBinge/llmFallback';
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
  const { user, uid } = useAuth();
  const myProviders = useMemo(() => user?.myProviders ?? [], [user?.myProviders]);
  const { items: watchlist } = useWatchlist();
  const { items: notInterested } = useNotInterested();

  const [input, setInput] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [filter, setFilter] = useState<AskFilter>({});
  // Whether the ORIGINAL parse came back empty — distinguishes "couldn't parse"
  // from "user removed every chip" (an intentional reset).
  const [parseEmpty, setParseEmpty] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiUsed, setAiUsed] = useState(false);
  const aiReqId = useRef(0);

  function runSearch(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const parsed = parseSearch(trimmed);
    setInput(trimmed);
    setSubmitted(trimmed);
    setFilter(parsed);
    setAiUsed(false);
    const low = isLowConfidence(parsed);
    setParseEmpty(low);
    trackEvent('ask_binge_submitted', { fields: Object.keys(parsed).length, lowConfidence: low });
    if (!low) return;
    // Rules gave up. Logged-in users get the LLM fallback; anonymous users get the
    // help state (the LLM is a spend, gated to accounts). recordAskBinge fires only
    // once we know the final outcome (AI helped, or genuinely low-confidence).
    if (!uid) { void recordAskBinge({ type: 'low_confidence' }); return; }
    const reqId = ++aiReqId.current;
    setAiLoading(true);
    void llmParseFallback(trimmed).then((aiFilter) => {
      if (aiReqId.current !== reqId) return; // a newer search superseded this one
      setAiLoading(false);
      if (aiFilter) {
        setFilter(aiFilter);
        setParseEmpty(false);
        setAiUsed(true);
        trackEvent('ask_binge_ai_fallback', { ok: true });
      } else {
        void recordAskBinge({ type: 'low_confidence' });
        trackEvent('ask_binge_ai_fallback', { ok: false });
      }
    }).catch(() => {
      // llmParseFallback never throws, but guard so the spinner can't get stuck.
      if (aiReqId.current === reqId) setAiLoading(false);
    });
  }

  function removeChip(key: keyof AskFilter) {
    // A chip removal is an explicit "you guessed wrong / I don't want this" signal.
    trackEvent('ask_binge_chip_removed', { key });
    void recordAskBinge({ type: 'chip_removed', key });
    setFilter((f) => {
      const next = { ...f };
      delete next[key];
      return next;
    });
  }

  const hasQuery = submitted.trim().length > 0;
  const currentEmpty = isLowConfidence(filter);
  // "Förstod inte" only when the original parse was empty; a self-cleared filter
  // shows the idle "alla filter borttagna" state instead.
  const lowConfidence = hasQuery && parseEmpty;
  const clearedAll = hasQuery && !parseEmpty && currentEmpty;
  // "På mina tjänster" but the user never picked any → askFilterToDiscoverParams
  // would silently drop the constraint and return ALL services. For a
  // streaming-first product that's the most damaging silent failure, so we stop
  // and nudge to settings instead (and skip the 4 TMDB calls entirely).
  const needsProviderSetup =
    hasQuery && !!filter.myProvidersOnly && !filter.providerIds?.length && myProviders.length === 0;
  // Don't spend TMDB discover quota on a parse that yielded nothing — the
  // low-confidence branch shows a help state instead of results.
  const canQuery = hasQuery && !currentEmpty && !needsProviderSetup;
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
    // Honor an explicit "högst betyg"-request; otherwise rank by popularity blend.
    return rankAskResults(deduped, filter.sortBy).slice(0, VISIBLE_CAP);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queries[0]?.data, queries[1]?.data, queries[2]?.data, queries[3]?.data, filter.excludeSeen, filter.sortBy, excludedIds]);

  // Telemetry: record how each settled search turned out, keyed off the CURRENT
  // filter (after any chip removals) — a parsed-fine-but-empty grid is our most
  // common silent failure and was previously invisible. PII-free: bucketed count
  // + fixed filter-type names only. Deduped per distinct query set so we fire once.
  const lastResultsKey = useRef<string | null>(null);
  useEffect(() => {
    if (!canQuery || isLoading) return;
    const key = `${mKey}|${tKey}`;
    if (lastResultsKey.current === key) return;
    lastResultsKey.current = key;
    const bucket = resultBucket(results.length);
    const filters = activeFilterSummary(filter);
    trackEvent('ask_binge_results', { resultBucket: bucket, mediaFilter: mediaFilterOf(filter), filters });
    void recordAskBinge({ type: 'search', resultBucket: bucket, filters });
  }, [canQuery, isLoading, mKey, tKey, results, filter]);

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
          <span className="text-ink-3" style={{ fontSize: 12 }}>{aiUsed ? 'Tolkning (AI):' : 'Tolkning:'}</span>
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
        ) : aiLoading ? (
          <LoadingView label="Tolkar din fråga…" variant="grid" />
        ) : lowConfidence ? (
          <EmptyState
            title="Jag förstod inte riktigt"
            body="Prova att nämna en genre (deckare, komedi), en tjänst (Netflix), en längd (under 90 min) eller ett årtionde (80-talet)."
          />
        ) : needsProviderSetup ? (
          <EmptyState
            title="Du har inte valt dina tjänster än"
            body="För att visa bara det du kan spela upp behöver Binge veta vilka streamingtjänster du har."
            action={<Link href="/settings/" className="btn btn-acc btn-sm">Välj dina tjänster</Link>}
          />
        ) : clearedAll ? (
          <EmptyState
            title="Alla filter borttagna"
            body="Lägg till ett filter igen, eller sök på något nytt i rutan ovan."
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
