import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import IntegritetPage from './page';

describe('integritetspolicyns innehållsförteckning', () => {
  it('länkar till varje avsnitt, och varje länk når en sektion som finns', () => {
    const { container } = render(<IntegritetPage />);
    const nav = screen.getByRole('navigation', { name: 'Innehåll' });
    const links = within(nav).getAllByRole('link');
    const sections = container.querySelectorAll('section[id]');
    expect(sections.length).toBeGreaterThan(0);
    expect(links.map(a => a.getAttribute('href'))).toEqual(
      Array.from(sections, s => `#${s.id}`),
    );
  });

  it('visar samma rubrik i förteckningen som i avsnittet', () => {
    const { container } = render(<IntegritetPage />);
    const nav = screen.getByRole('navigation', { name: 'Innehåll' });
    for (const a of within(nav).getAllByRole('link')) {
      const target = container.querySelector(a.getAttribute('href')!);
      expect(target?.querySelector('h2')?.textContent).toBe(a.textContent);
    }
  });
});
