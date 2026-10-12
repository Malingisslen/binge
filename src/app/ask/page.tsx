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
import { applySavedFilters } from '@/lib/askBinge/savedFilters';
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
import { mediaTypeDocId } from '@/lib/mediaTypeDocId';
import type { RowTitle, TMDBSearchResult } from '@/types';
import { Button, buttonClass } from '@/components/ui/Button';
import { fieldClass } from '@/components/ui/Field';
import { cardClass } from '@/components/ui/Card';

const EXAMPLES = [
  'mysig komedi under 90 min',
  'hyllad svensk deckare jag inte sett',
  'skräckfilm från 80-talet',
  'sci-fi-serie på mina tjänster',
];

const VISIBLE_CAP = 60;
const SHALLOW_PAGES = 2;
const DEEP_PAGES = 5;

export default function AskPage() {
  const { user, uid } = useAuth();
  const myProviders = useMemo(() => user?.myProviders ?? [], [user?.myProviders]);
  const hideNonLatinTitles = user?.hideNonLatinTitles ?? false;
  const hiddenCountries = useMemo(() => user?.hiddenCountries ?? [], [user?.hiddenCountries]);
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
  // and nudge to settings instead (and skip the TMDB calls entirely).
  const needsProviderSetup =
    hasQuery && !!filter.myProvidersOnly && !filter.providerIds?.length && myProviders.length === 0;
  // Don't spend TMDB discover quota on a parse that yielded nothing — the
  // low-confidence branch shows a help state instead of results.
  const canQuery = hasQuery && !currentEmpty && !needsProviderSetup;
  const plan = useMemo(() => askFilterToDiscoverParams(filter, { myProviders, hiddenCountries }), [filter, myProviders, hiddenCountries]);
  const chips = useMemo(() => describeFilter(filter), [filter]);

  // Titles the user has already seen / started / dropped — only used when the query
  // asked to exclude them.
  const seenIds = useMemo(() => {
    // BIN-560 Phase 4: composite-keyed (mediaTypeDocId) — a movie/TV tmdbId clash
    // must not cross-exclude in the Ask-Binge recommendation filter.
    const s = new Set<string>();
    for (const it of watchlist) {
      if (it.status === 'sedd' || it.status === 'avbruten') s.add(mediaTypeDocId(it.mediaType, it.tmdbId));
      else if (it.mediaType === 'tv' && it.status === 'mina' && it.lastWatchedSeason != null) s.add(mediaTypeDocId(it.mediaType, it.tmdbId));
    }
    return s;
  }, [watchlist]);

  // "Inte intresserad" is a standing choice, so it holds for every question.
  const notInterestedIds = useMemo(
    () => new Set(notInterested.map((n) => mediaTypeDocId(n.mediaType, n.tmdbId))),
    [notInterested],
  );
  const excludedIds = useMemo(
    () => (filter.excludeSeen ? new Set([...seenIds, ...notInterestedIds]) : notInterestedIds),
    [filter.excludeSeen, seenIds, notInterestedIds],
  );

  const mKey = JSON.stringify(plan.movieParams);
  const tKey = JSON.stringify(plan.tvParams);

  // Hiding countries/scripts throws away most of a page of popular titles, so look
  // deeper when one is on.
  const pageCount = hideNonLatinTitles || hiddenCountries.length ? DEEP_PAGES : SHALLOW_PAGES;
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);
  const queries = useQueries({
    queries: [
      ...pages.map((page) => ({
        queryKey: ['ask-movie', mKey, page],
        queryFn: ({ signal }: { signal?: AbortSignal }) => discoverMovies({ ...plan.movieParams, page: String(page) }, { signal }),
        staleTime: TMDB_STALE.DISCOVER,
        enabled: canQuery && plan.wantMovies,
      })),
      ...pages.map((page) => ({
        queryKey: ['ask-tv', tKey, page],
        queryFn: ({ signal }: { signal?: AbortSignal }) => discoverTV({ ...plan.tvParams, page: String(page) }, { signal }),
        staleTime: TMDB_STALE.DISCOVER,
        enabled: canQuery && plan.wantTV,
      })),
    ],
  });

  const isLoading = hasQuery && queries.some((q) => q.isLoading);

  // useQueries returns fresh arrays each render; key the memo on what changed.
  const dataSig = queries.map((q) => q.dataUpdatedAt).join(',');

  const results = useMemo(() => {
    const items: RowTitle[] = [];
    const push = (arr: TMDBSearchResult[] | undefined, media: 'movie' | 'tv') =>
      (arr ?? []).forEach((r) => items.push({ ...r, media_type: media }));
    queries.forEach((q, i) => push(q.data?.results, i < pageCount ? 'movie' : 'tv'));
    const deduped = applySavedFilters(
      dedupeAndExclude(items, excludedIds).filter(isAddableMediaType),
      filter,
      { hideNonLatinTitles, hiddenCountries },
    );
    // Honor an explicit "högst betyg"-request; otherwise rank by popularity blend.
    return rankAskResults(deduped, filter.sortBy).slice(0, VISIBLE_CAP);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSig, pageCount, filter.sortBy, filter.originalLanguage, excludedIds, hideNonLatinTitles, hiddenCountries]);

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
            className={fieldClass({ className: 'w-full' })}
            style={{ padding: '8px 10px 8px 30px', fontSize: 'var(--fs-lg)' }}
          />
        </div>
        <Button type="submit" variant="acc" style={{ whiteSpace: 'nowrap' }}>Sök</Button>
      </form>

      {/* Examples — only before the first search */}
      {!hasQuery && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
          <span className="text-ink-3" style={{ fontSize: 'var(--fs-sm)', alignSelf: 'center' }}>Prova:</span>
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" className="chip" onClick={() => runSearch(ex)}>{ex}</button>
          ))}
        </div>
      )}

      {/* Interpreted filter as removable chips */}
      {hasQuery && chips.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 14, alignItems: 'center' }}>
          <span className="text-ink-3" style={{ fontSize: 'var(--fs-sm)' }}>{aiUsed ? 'Tolkning (AI):' : 'Tolkning:'}</span>
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
          // Inline "thinking" indicator — NOT a results-grid skeleton, so an empty
          // AI result doesn't look like titles loading then being yanked away.
          <LoadingView label="Tolkar din fråga…" />
        ) : lowConfidence ? (
          <EmptyState
            title="Jag förstod inte riktigt"
            body="Prova att nämna en genre (deckare, komedi), en tjänst (Netflix), en längd (under 90 min) eller ett årtionde (80-talet)."
          />
        ) : needsProviderSetup ? (
          <EmptyState
            title="Du har inte valt dina tjänster än"
            body="För att visa bara det du kan spela upp behöver Binge veta vilka streamingtjänster du har."
            action={<Link href="/settings/" className={buttonClass({ variant: 'acc', size: 'sm' })}>Välj dina tjänster</Link>}
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
          <div className={cardClass()}>
            <TitleGrid items={results} />
            <div className="px-3 py-1.5 border-t border-rule-2">
              <JustWatchCredit />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
