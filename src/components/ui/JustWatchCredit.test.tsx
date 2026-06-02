import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import JustWatchCredit from './JustWatchCredit';
import {
  JUSTWATCH_ATTRIBUTION_SV,
  JUSTWATCH_ATTRIBUTION_EN,
} from '@/lib/tmdb/attribution';

// TMDB's villkor kräver en JustWatch-credit *där* watch-provider-datan visas
// (se attribution.ts). Den här testen vaktar att creditet (a) faktiskt
// renderar och (b) nämner JustWatch — så att en regress inte tyst tömmer den.
describe('JustWatchCredit', () => {
  it('renders the Swedish JustWatch credit text', () => {
    render(<JustWatchCredit />);
    expect(screen.getByText(JUSTWATCH_ATTRIBUTION_SV)).toBeInTheDocument();
  });

  it('credit text mentions JustWatch by name (TMDB-villkor)', () => {
    expect(JUSTWATCH_ATTRIBUTION_SV).toMatch(/JustWatch/);
    expect(JUSTWATCH_ATTRIBUTION_EN).toMatch(/JustWatch/);
  });

  it('forwards a className for placement', () => {
    const { container } = render(<JustWatchCredit className="pt-1" />);
    expect(container.firstChild).toHaveClass('pt-1');
  });
});
