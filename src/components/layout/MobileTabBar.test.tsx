import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import MobileTabBar, { TOPBAR_SEARCH_ID } from './MobileTabBar';
import Subnav from './Subnav';

const nav = vi.hoisted(() => ({ pathname: '/my/all/' }));
const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => {
  const router = { push };
  return { usePathname: () => nav.pathname, useRouter: () => router };
});

function moreButton() {
  return screen.getByRole('button', { name: 'Mer' });
}
function panel() {
  return document.getElementById(moreButton().getAttribute('aria-controls')!)!;
}

beforeEach(() => {
  nav.pathname = '/my/all/';
  push.mockReset();
  document.body.innerHTML = '';
});

describe('MobileTabBar (variant B)', () => {
  it('shows the five tabs with full words', () => {
    render(<MobileTabBar />);
    const bar = screen.getByRole('navigation', { name: 'Huvudmeny' });
    const names = Array.from(bar.children).map(el => el.textContent);
    expect(names[0]).toBe('Bibliotek');
    expect(names[1]).toBe('Kalender');
    expect(names[2]).toBe('Sök');
    expect(names[3]).toBe('Rådgivaren');
    expect(names[4]?.startsWith('Mer')).toBe(true);
  });

  it('Sök focuses the topbar search field instead of navigating', () => {
    const input = document.createElement('input');
    input.id = TOPBAR_SEARCH_ID;
    document.body.appendChild(input);
    render(<MobileTabBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Sök' }));
    expect(document.activeElement).toBe(input);
    expect(push).not.toHaveBeenCalled();
  });

  it('Sök falls back to the search page when no field is on screen', () => {
    render(<MobileTabBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Sök' }));
    expect(push).toHaveBeenCalledWith('/search/');
  });

  it('Mer opens a panel listing every section without a tab', () => {
    render(<MobileTabBar />);
    expect(moreButton()).toHaveAttribute('aria-expanded', 'false');
    expect(panel()).not.toBeVisible();
    fireEvent.click(moreButton());
    expect(moreButton()).toHaveAttribute('aria-expanded', 'true');
    const links = within(panel()).getAllByRole('link').map(a => a.textContent);
    expect(links).toEqual(['Hem', 'Rekommendationer', 'Fråga Binge', 'Vänner', 'Inställningar']);
  });

  it('Escape closes Mer and returns focus to the button', () => {
    render(<MobileTabBar />);
    fireEvent.click(moreButton());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(moreButton()).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(moreButton());
  });

  it('a tap outside closes Mer', () => {
    render(<MobileTabBar />);
    fireEvent.click(moreButton());
    fireEvent.mouseDown(document.body);
    expect(moreButton()).toHaveAttribute('aria-expanded', 'false');
  });

  it('navigating to another page closes Mer', () => {
    const { rerender } = render(<MobileTabBar />);
    fireEvent.click(moreButton());
    nav.pathname = '/grupper/';
    rerender(<MobileTabBar />);
    expect(moreButton()).toHaveAttribute('aria-expanded', 'false');
  });

  it('tapping Sök closes Mer', () => {
    render(<MobileTabBar />);
    fireEvent.click(moreButton());
    fireEvent.click(screen.getByRole('button', { name: 'Sök' }));
    expect(moreButton()).toHaveAttribute('aria-expanded', 'false');
  });

  it.each([
    ['/', 'Mer'],
    ['/recommendations/', 'Mer'],
    ['/kalibrera/', 'Mer'],
    ['/ask/', 'Mer'],
    ['/my/friends/', 'Mer'],
    ['/feed/', 'Mer'],
    ['/user/anna/', 'Mer'],
    ['/settings/', 'Mer'],
    ['/my/all/', 'Bibliotek'],
    ['/my/series/', 'Bibliotek'],
    ['/calendar/', 'Kalender'],
    ['/savings/', 'Rådgivaren'],
  ])('on %s only %s is marked active', (path, expected) => {
    nav.pathname = path;
    render(<MobileTabBar />);
    const bar = screen.getByRole('navigation', { name: 'Huvudmeny' });
    const on = Array.from(bar.querySelectorAll(':scope > .is-on, :scope > .m-more > button.is-on'))
      .map(el => el.textContent);
    expect(on).toEqual([expected]);
  });

  // The subnav is hidden on phones, so anything it links to must be reachable here.
  it('reaches every section the desktop subnav links to', () => {
    render(<><Subnav /><MobileTabBar /></>);
    const subnav = screen.getByRole('navigation', { name: 'Sektioner' });
    const bar = screen.getByRole('navigation', { name: 'Huvudmeny' });
    const phoneHrefs = Array.from(bar.querySelectorAll('a')).map(a => a.getAttribute('href'));
    const subnavHrefs = Array.from(subnav.querySelectorAll('a')).map(a => a.getAttribute('href'));
    expect(subnavHrefs.length).toBeGreaterThan(0);
    for (const href of subnavHrefs) expect(phoneHrefs).toContain(href);
  });

  // Grupper is paused (plan round 2, decision 4): no menu links to it, and a
  // group page reached by an old link marks no tab as current.
  it.each(['/grupper/abc/', '/tillsammans/xyz/'])('no tab is current on %s', path => {
    nav.pathname = path;
    render(<><Subnav /><MobileTabBar /></>);
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(0);
    expect(document.querySelectorAll('a[href^="/grupper"], a[href^="/tillsammans"]')).toHaveLength(0);
  });
});

describe('MobileTabBar for signed-out visitors', () => {
  it('shows only pages that work without an account', () => {
    render(<MobileTabBar chrome="guest" />);
    const bar = screen.getByRole('navigation', { name: 'Huvudmeny' });
    expect(Array.from(bar.children).map(el => el.textContent)).toEqual(['Hem', 'Priser', 'Sök', 'Kalkylator', 'Guider']);
    expect(screen.queryByRole('button', { name: 'Mer' })).toBeNull();
  });

  it('marks the calculator tab on the calculator page', () => {
    nav.pathname = '/streamingkostnad/';
    render(<MobileTabBar chrome="guest" />);
    expect(screen.getByRole('link', { name: 'Kalkylator' })).toHaveAttribute('aria-current', 'page');
  });

  it.each([
    ['/guider/vad-kostar-netflix/', 'Guider'],
    ['/streamingpriser/', 'Priser'],
    ['/streamingkostnad/', 'Kalkylator'],
    ['/', 'Hem'],
  ])('on %s only %s is the current guest tab', (path, expected) => {
    nav.pathname = path;
    render(<MobileTabBar chrome="guest" />);
    expect(Array.from(document.querySelectorAll('[aria-current="page"]')).map(el => el.textContent)).toEqual([expected]);
  });

  it('Sök focuses the topbar search field', () => {
    const input = document.createElement('input');
    input.id = TOPBAR_SEARCH_ID;
    document.body.appendChild(input);
    render(<MobileTabBar chrome="guest" />);
    fireEvent.click(screen.getByRole('button', { name: 'Sök' }));
    expect(document.activeElement).toBe(input);
  });

  // Before auth answers both bars are in the page, each wrapped so CSS can pick one
  // from the returning-user flag.
  it('renders both bars, wrapped, while auth is unknown', () => {
    const { container } = render(<MobileTabBar chrome="unknown" />);
    expect(container.querySelector('.pre-app nav')).not.toBeNull();
    expect(container.querySelector('.pre-guest nav')).not.toBeNull();
  });
});
