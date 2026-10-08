import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CoverageOptimizer from './CoverageOptimizer';

describe('CoverageOptimizer', () => {
  it('"Skaffa" leder till tjänstens sida', () => {
    render(
      <CoverageOptimizer
        rows={[{
          providerId: 1899, providerName: 'Max', shortName: 'Max', color: 'var(--ink)',
          isSubscribed: false, monthlyCost: 129, tvCount: 2, movieCount: 1,
        }]}
      />,
    );
    expect(screen.getByRole('link', { name: 'Skaffa Max' }).getAttribute('href')).toMatch(/^\/provider\/1899\/?$/);
  });
});
