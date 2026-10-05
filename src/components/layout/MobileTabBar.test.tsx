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
    expect(links).toEqual(['Hem', 'Rekommendationer', 'Fråga Binge', 'Vänner', 'Grupper', 'Inställningar']);
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
    ['/grupper/abc/', 'Mer'],
    ['/tillsammans/xyz/', 'Mer'],
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
});
