// src/components/pages/PersonPageClient.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// BIN-687 — the person sibling of MoviePageClient.test.tsx / TVShowPageClient.test.tsx.
// PersonPageClient was the only product file changed by BIN-656 without a test, so
// nothing pinned the COMPONENT's wiring: that usePageMeta actually receives the
// built description, which bio source is allowed to reach it, and that the memo
// recomputes when the person finally lands.
//
// Two rules are load-bearing here and neither is visible from contentFloor.test.ts:
//
//  1. The page body shows a biography from three sources in order — TMDB sv,
//     svenska Wikipedia, TMDB en. The <meta> description may only ever use the
//     FIRST. Wikipedia prose is CC BY-SA and must carry attribution wherever it
//     travels (BIN-686); a search snippet cannot carry the credit link the body
//     renders. The English bio is labelled "Biografi på engelska" in the body and
//     a SERP snippet carries no such label. So both are deliberately absent from
//     the description while being present on the page — which is exactly why the
//     tests below render the body and assert on both halves at once. A test that
//     only checked "description has no Wikipedia text" would also pass against a
//     component that never fetched the Wikipedia bio at all.
//
//  2. The description is a useMemo over `person`. On every real page load the
//     first render has no person yet, so a dropped dependency ships `undefined`
//     to usePageMeta forever and the pre-rendered/catch-all shell's description
//     is never replaced. The last test drives the whole transition instead of
//     asserting one settled frame (lessons-digest, 2026-08-01).

// The module graph reaches Firebase config, whose top-level getAuth() throws on
// the dummy test-env key. Nothing on the tested path touches it.
vi.mock('@/lib/firebase/config', () => ({ auth: {}, default: {} }));

const usePageMeta = vi.hoisted(() => vi.fn());

// ONE mutable state object, read by every mock — a per-call factory would mint new
// identities and make the dependency-array assertions vacuous.
const state = vi.hoisted(() => ({
  person: undefined as Record<string, unknown> | undefined,
  isLoading: true,
  wikiBio: null as { text: string; pageUrl: string } | null,
  enBio: '',
}));

const useSwedishWikiBio = vi.hoisted(() => vi.fn());
const personEnQuery = vi.hoisted(() => ({ enabled: undefined as boolean | undefined }));

vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta }));
vi.mock('@/hooks/useTMDB', () => ({
  usePerson: () => ({ data: state.person, isLoading: state.isLoading }),
  usePersonCredits: () => ({ data: undefined }),
}));
// Both fallback sources answer whatever the fixture holds, REGARDLESS of the
// `enabled` flag the component passes. Honouring the flag would make the
// precedence assertions vacuous — the component would never see a competing bio
// to reject, so reordering `svBio || wikiBio || enBio` would survive. The flags
// are pinned separately below, as the request-avoidance they actually are.
vi.mock('@/hooks/useSwedishWikiBio', () => ({ useSwedishWikiBio }));
vi.mock('@/hooks/useWatchlist', () => ({
  useWatchlist: () => ({ getItem: () => undefined, loading: false }),
}));
// The English-bio fallback is a bare useQuery inside the component; there is no
// QueryClientProvider in this test, so stand in for it.
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useQuery: (options: { queryKey: readonly unknown[]; enabled?: boolean }) => {
    if (options.queryKey[0] !== 'person-en') return { data: undefined };
    personEnQuery.enabled = options.enabled;
    return { data: { biography: state.enBio } };
  },
}));

import PersonPageClient from './PersonPageClient';

const SV_BIO =
  'Alicia Vikander är en svensk skådespelare från Göteborg. Hon slog igenom i En kunglig affär.';
const WIKI_BIO =
  'Alicia Vikander är en svensk skådespelare som slog igenom i En kunglig affär och senare vann en Oscar.';
const EN_BIO =
  'Alicia Vikander is a Swedish actress who broke through in A Royal Affair and later won an Academy Award.';

// Every fact in this fixture is one the generated fallback line is built from, so
// the assertions below also pin the person → PersonDescriptionInput mapping.
const person = {
  id: 543530,
  name: 'Alicia Vikander',
  biography: '',
  known_for_department: 'Acting',
  birthday: '1988-10-03',
  place_of_birth: 'Göteborg, Sverige',
  profile_path: '/alicia.jpg',
};

// The line buildPersonDescription produces from those facts alone.
const GENERATED =
  'Alicia Vikander (Skådespelare), född 1988 i Göteborg, Sverige. Filmografi och var titlarna streamas i Sverige.';

function lastDescription(): string | undefined {
  const call = usePageMeta.mock.calls.at(-1)?.[0] as { description?: string } | undefined;
  return call?.description;
}

describe('PersonPageClient — which biography reaches the meta description (BIN-656/686)', () => {
  beforeEach(() => {
    usePageMeta.mockReset();
    useSwedishWikiBio.mockReset();
    useSwedishWikiBio.mockImplementation(() => state.wikiBio);
    personEnQuery.enabled = undefined;
    state.person = { ...person };
    state.isLoading = false;
    state.wikiBio = null;
    state.enBio = '';
  });

  it('sends the Swedish TMDB biography to the snippet, verbatim', () => {
    state.person = { ...person, biography: SV_BIO };
    render(<PersonPageClient id="543530" />);

    expect(lastDescription()).toBe(SV_BIO);
    // …and it is the bio the page itself shows, with no source credit needed.
    expect(screen.getByText(SV_BIO)).toBeTruthy();
    expect(screen.queryByText(/svenska Wikipedia/)).toBeNull();
  });

  it('shows the Wikipedia biography on the page but keeps it out of the snippet (CC BY-SA)', () => {
    state.wikiBio = { text: WIKI_BIO, pageUrl: 'https://sv.wikipedia.org/wiki/Alicia_Vikander' };
    render(<PersonPageClient id="543530" />);

    // Present on the page, where the credit link travels with it.
    expect(screen.getByText(WIKI_BIO)).toBeTruthy();
    expect(screen.getByText(/svenska Wikipedia/)).toBeTruthy();

    // Absent from the description, which cannot carry that credit.
    expect(lastDescription()).toBe(GENERATED);
    expect(lastDescription()).not.toContain('slog igenom');
  });

  it('shows the English biography labelled but keeps it out of the snippet too', () => {
    state.enBio = EN_BIO;
    render(<PersonPageClient id="543530" />);

    expect(screen.getByText(EN_BIO)).toBeTruthy();
    expect(screen.getByText(/Biografi på engelska/)).toBeTruthy();

    expect(lastDescription()).toBe(GENERATED);
    expect(lastDescription()).not.toContain('Swedish actress');
  });

  it('prefers the Swedish TMDB bio over both fallbacks when all three exist', () => {
    state.person = { ...person, biography: SV_BIO };
    state.wikiBio = { text: WIKI_BIO, pageUrl: 'https://sv.wikipedia.org/wiki/Alicia_Vikander' };
    state.enBio = EN_BIO;
    render(<PersonPageClient id="543530" />);

    expect(lastDescription()).toBe(SV_BIO);
    expect(screen.getByText(SV_BIO)).toBeTruthy();
    expect(screen.queryByText(WIKI_BIO)).toBeNull();
    expect(screen.queryByText(EN_BIO)).toBeNull();
  });

  it('does not spend a Wikipedia or English request when TMDB already answered in Swedish', () => {
    state.person = { ...person, biography: SV_BIO };
    render(<PersonPageClient id="543530" />);

    // Precedence is enforced twice over: the order above, and these two flags —
    // both fallbacks are switched off, so a person with a Swedish bio costs
    // exactly the requests the page already made.
    expect(useSwedishWikiBio).toHaveBeenLastCalledWith(person.id, false);
    expect(personEnQuery.enabled).toBe(false);
  });

  it('turns both fallbacks on only when the Swedish bio is missing', () => {
    render(<PersonPageClient id="543530" />);

    expect(useSwedishWikiBio).toHaveBeenLastCalledWith(person.id, true);
    expect(personEnQuery.enabled).toBe(true);
  });

  // BIN-734/735 — pinning a DECISION, not just behaviour. BIN-734 asked for the
  // 60-character `hasSubstantialText` gate to be put on the visible biography,
  // to match what BIN-688 did on the film and series pages. It was deliberately
  // not done: BIN-735 established hours later that the threshold is a
  // snippet-quality measure and must never decide whether real text appears on
  // the page at all. Film and series pages now render a thin overview AND the
  // generated sentence; a person page has no generated paragraph to add, so the
  // same rule here simply means "keep the biography". Without this test the next
  // pass reads the ticket, applies the one-liner, and silently deletes short
  // biographies from every person page.
  it('keeps a thin but genuine Swedish biography on the page, even though the snippet falls back', () => {
    const THIN_BIO = 'Svensk skådespelare.';
    state.person = { ...person, biography: THIN_BIO };
    render(<PersonPageClient id="543530" />);

    // On the page: the person's own words, short as they are.
    expect(screen.getByText(THIN_BIO)).toBeTruthy();
    // In the snippet: the generated line, because twenty characters make a poor
    // search result. The body is a superset of the snippet, which is the
    // property BIN-688 was protecting.
    expect(lastDescription()).toBe(GENERATED);
  });

  it('renders nothing at all for a biography that is only whitespace', () => {
    // TMDB does return blank-but-truthy bios. A bare truthiness check rendered
    // an empty paragraph — and, for the Wikipedia source, an orphan credit line
    // under it.
    state.person = { ...person, biography: '   \n  ' };
    const { container } = render(<PersonPageClient id="543530" />);

    // The biography paragraph is the only clamped one on the page.
    expect(container.querySelector('p.line-clamp-6')).toBeNull();
  });

  // BIN-747 — the whitespace bio used to be suppressed TWICE over: truthy enough
  // to switch both fallback sources off, blank enough for the render guard to
  // hide. The person got no biography at all, and no request was ever spent
  // looking for one. Trimming at the source is what makes these two tests
  // different from each other: the one above still renders nothing (there is
  // genuinely nothing to show), this one recovers the Wikipedia text.
  it('falls back to Wikipedia when the TMDB biography is only whitespace', () => {
    state.person = { ...person, biography: '   \n  ' };
    state.wikiBio = { text: WIKI_BIO, pageUrl: 'https://sv.wikipedia.org/wiki/Alicia_Vikander' };
    render(<PersonPageClient id="543530" />);

    // The requests are actually made — a blank-but-truthy bio must not read as
    // "TMDB already answered in Swedish".
    expect(useSwedishWikiBio).toHaveBeenLastCalledWith(person.id, true);
    expect(personEnQuery.enabled).toBe(true);

    // …and the recovered text reaches the page, credit and all.
    expect(screen.getByText(WIKI_BIO)).toBeTruthy();
    expect(screen.getByText(/svenska Wikipedia/)).toBeTruthy();
  });

  it('falls back to the English biography when the TMDB Swedish one is only whitespace', () => {
    state.person = { ...person, biography: ' \t ' };
    state.enBio = EN_BIO;
    render(<PersonPageClient id="543530" />);

    expect(screen.getByText(EN_BIO)).toBeTruthy();
    expect(screen.getByText(/Biografi på engelska/)).toBeTruthy();
  });

  it('does not leak the blank source into the biography it renders', () => {
    // A trimmed-empty Swedish bio must not win precedence over a real fallback,
    // and must not survive into the visible paragraph as padding either.
    state.person = { ...person, biography: '\n\n' };
    state.wikiBio = { text: WIKI_BIO, pageUrl: 'https://sv.wikipedia.org/wiki/Alicia_Vikander' };
    state.enBio = EN_BIO;
    const { container } = render(<PersonPageClient id="543530" />);

    const bio = container.querySelector('p.line-clamp-6');
    expect(bio?.textContent).toBe(WIKI_BIO);
    // Wikipedia beats English, exactly as it does for a bio that is absent
    // outright — whitespace changes nothing about the order.
    expect(screen.queryByText(/Biografi på engelska/)).toBeNull();
  });

  it('replaces the shell description once the person arrives, not just on the first frame', () => {
    // Cold load: TMDB has not answered yet.
    state.person = undefined;
    state.isLoading = true;
    const { rerender } = render(<PersonPageClient id="543530" />);
    expect(lastDescription()).toBeUndefined();

    // The person lands. A memo missing `person` in its dependency array would
    // still be handing usePageMeta the undefined it computed above.
    state.person = { ...person, biography: SV_BIO };
    state.isLoading = false;
    rerender(<PersonPageClient id="543530" />);

    expect(lastDescription()).toBe(SV_BIO);
  });
});
