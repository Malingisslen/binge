// src/components/calendar/EventCard.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import EventCard from './EventCard';
import type { EpisodeEntry, MovieEntry } from '@/lib/calendar/types';

// BIN-660 — the "markera sedd"-toggle must be a SIBLING of the card's link,
// never a descendant of it.
//
// Interactive content inside an <a> is invalid HTML, and assistive tech handles
// it inconsistently: the toggle is the most-used action on the calendar, so a
// keyboard or screen-reader user hit the barrier on the app's core weekly task.
// The old markup only worked for a mouse because the handler called
// preventDefault/stopPropagation — a workaround for the nesting, not a fix.
//
// So the assertions below are about STRUCTURE, not about the handler: a future
// edit that re-nests the button inside the Link and re-adds the event surgery
// would still pass a "clicking the toggle calls markEpisodeWatched" test. Only
// `link.contains(button) === false` catches it.

const markEpisodeWatched = vi.hoisted(() => vi.fn());
const isWatched = vi.hoisted(() => vi.fn<(s: number, e: number) => boolean>(() => false));

vi.mock('@/hooks/useEpisodeProgressWithSync', () => ({
  useEpisodeProgressWithSync: () => ({ isWatched, markEpisodeWatched }),
}));

const episode: EpisodeEntry = {
  kind: 'episode',
  mediaType: 'tv',
  tmdbId: 1399,
  title: 'Game of Thrones',
  posterPath: null,
  backdropPath: null,
  airDate: '2026-08-05',
  season: 2,
  episode: 7,
  episodeCode: 'S02E07',
  episodeName: 'A Man Without Honor',
};

const movie: MovieEntry = {
  kind: 'movie',
  mediaType: 'movie',
  tmdbId: 603,
  title: 'The Matrix',
  posterPath: null,
  backdropPath: null,
  airDate: '2026-08-05',
  releaseType: 'digital',
  overview: 'En hacker upptäcker sanningen om sin värld.',
};

const toggle = () => screen.getByRole('button');
const cardLink = () => screen.getByRole('link');

describe('EventCard — toggle is outside the link (BIN-660)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isWatched.mockReturnValue(false);
  });

  // Both ends matter. "Outside the link" alone is satisfied by a toggle that
  // escaped the card entirely — it would float outside the card's border, since
  // the border, the clipping and the column live on the root.
  it('puts the toggle outside the card link but still inside the card', () => {
    const { container } = render(<EventCard entry={episode} />);

    expect(cardLink().contains(toggle())).toBe(false);
    expect(container.firstElementChild).toContainElement(toggle());
  });

  // The tag-based twin of the test above. It catches a new interactive ELEMENT
  // dropped into the anchor later; the role-based test catches a div wearing
  // role="button". Neither subsumes the other, so both stay.
  it('leaves no interactive element anywhere inside the link', () => {
    render(<EventCard entry={episode} />);

    expect(cardLink().querySelectorAll('button, a, input, select, textarea')).toHaveLength(0);
  });

  // The card root owns the border, the corner clipping, the flex column and the
  // plum "today" rule. This diff is what moved those classes onto a new element,
  // so losing them is a live risk and a bigger regression than the focus ring.
  // Probed per term: the className is built from three independent pieces, and
  // dropping any one of them is invisible to an assertion on the other two.
  it('keeps the card chrome on the root element', () => {
    const { container, rerender } = render(<EventCard entry={episode} />);

    expect(container.firstElementChild).toHaveClass('ev');
    expect(container.firstElementChild).not.toHaveClass('is-tonight');
    expect(container.firstElementChild).not.toHaveClass('is-watched');

    rerender(<EventCard entry={episode} isTonight />);
    expect(container.firstElementChild).toHaveClass('ev', 'is-tonight');
  });

  // The layout the anchor took over from `.ev` in this very diff. jsdom cannot
  // compute it, so the class string is the only thing that can pin it — without
  // `flex-1` the anchor stops filling the card and the footer floats up.
  it('gives the link the column layout the card root used to own', () => {
    render(<EventCard entry={episode} />);

    expect(cardLink().className).toContain('flex-1');
    expect(cardLink().className).toContain('flex-col');
  });

  // Acceptance #3 — "no visual change" — rests entirely on this arithmetic:
  // 8px above the toggle (the .body override) and 12px below it (the footer's
  // own padding), replacing the spacing the toggle had inside .body. Both
  // numbers survive deletion unless asserted.
  it('keeps the toggle row spaced exactly as it was inside the body', () => {
    const { container } = render(<EventCard entry={episode} />);

    expect(container.querySelector('.body')).toHaveStyle({ paddingBottom: '8px' });
    expect(toggle().parentElement).toHaveStyle({ padding: '0 12px 12px' });
  });

  // The movie card keeps `.body`'s own 12px bottom padding — the override above
  // exists only to make room for the hoisted toggle.
  it('leaves the movie card body padding untouched', () => {
    const { container } = render(<EventCard entry={movie} />);

    expect(container.querySelector('.body')).not.toHaveStyle({ paddingBottom: '8px' });
  });

  // The consequence that made the nesting a bug: a click on the toggle must not
  // be a click on the link. With the button outside the anchor this holds by
  // construction — which is why the handler no longer needs preventDefault.
  it('marks the episode watched without the click reaching an anchor', async () => {
    render(<EventCard entry={episode} />);

    await act(async () => { fireEvent.click(toggle()); });

    expect(markEpisodeWatched).toHaveBeenCalledWith(2, 7, true);
    expect(toggle().closest('a')).toBeNull();
  });

  it('unmarks an episode that is already watched', async () => {
    isWatched.mockReturnValue(true);
    const { container } = render(<EventCard entry={episode} />);

    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
    expect(toggle()).toHaveTextContent('sett');
    // The filled square is the only signal a sighted user gets; aria-pressed
    // and the label would both stay correct if `is-on` silently stopped.
    expect(toggle().querySelector('.ev-toggle')).toHaveClass('is-on');
    // …and `.ev.is-watched` is what dims the whole card (bg-2 surface, 55%
    // poster, muted title). It fails silently and independently of `is-on`.
    expect(container.firstElementChild).toHaveClass('is-watched');

    await act(async () => { fireEvent.click(toggle()); });

    expect(markEpisodeWatched).toHaveBeenCalledWith(2, 7, false);
  });

  it('labels the control from its own text, so the accessible name survives the state flip', () => {
    render(<EventCard entry={episode} />);

    // No aria-label: an override would freeze the name while the visible text
    // changes to "sett", breaking WCAG's label-in-name for voice control.
    expect(toggle()).not.toHaveAttribute('aria-label');
    expect(toggle()).toHaveTextContent('markera sedd');
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    expect(toggle().querySelector('.ev-toggle')).not.toHaveClass('is-on');
    // The read path's argument order is as easy to swap as the write path's.
    expect(isWatched).toHaveBeenCalledWith(2, 7);
  });

  // The movie branch is the other half of a discriminated union — none of the
  // episode coverage above transfers to it.
  it('gives a movie release no toggle, and keeps its label inside the link', () => {
    render(<EventCard entry={movie} />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(cardLink()).toContainElement(screen.getByText('vill se'));
    expect(cardLink().getAttribute('href')).toMatch(/^\/movie\/603\/?$/);
    expect(cardLink()).toHaveAttribute('aria-label', 'The Matrix · digital release');
  });

  it('keeps the card link pointing at the title page', () => {
    render(<EventCard entry={episode} />);

    // entryHref() emits the trailing slash that `trailingSlash: true` needs;
    // next/link normalises it away in jsdom, so match on the resolved path and
    // let src/lib/calendar/entry.test.ts keep pinning the exact string.
    expect(cardLink().getAttribute('href')).toMatch(/^\/tv\/1399\/?$/);
    expect(cardLink()).toHaveAttribute('aria-label', 'Game of Thrones · S02E07');
  });

  // The focus ring is drawn 2px OUTSIDE the border box by globals.css, and the
  // card root clips its children (`overflow: hidden`, which rounds the still's
  // top corners). Now that the anchor — not the card root — is what receives
  // focus, an outward ring is clipped on three sides and survives as a stray
  // line across the footer. The inward offset is the fix, and nothing else
  // pins it: a keyboard user would lose their focus indicator silently.
  it('draws the focus ring inward so the card does not clip it', () => {
    render(<EventCard entry={episode} />);

    expect(cardLink().className).toContain('focus-visible:[outline-offset:-2px]');
  });
});
