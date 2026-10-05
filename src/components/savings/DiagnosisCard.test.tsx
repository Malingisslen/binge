import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DiagnosisCard from './DiagnosisCard';
import type { AdvisorResult } from '@/types';

// Paket I (2026-10-05): totalen märks "(uppskattat)" när hooken säger att minst ett
// belopp är katalogens listpris. Vilka belopp det gäller avgörs av
// isEstimatedMonthlyCost (src/lib/advisor/costEstimate.test.ts), inte här.
function advisor(estimated: boolean): AdvisorResult {
  return {
    totalMonthlyCost: 318,
    totalMonthlyCostEstimated: estimated,
    primaryAction: { kind: 'idle', nextCheckDate: null },
  } as unknown as AdvisorResult;
}

describe('DiagnosisCard — uppskattat', () => {
  it('märker totalen när ett belopp är listpriset', () => {
    render(<DiagnosisCard advisor={advisor(true)} activeProviderCount={2} />);
    expect(screen.getByText(/Du betalar/)).toHaveTextContent('Du betalar 318 kr/mån (uppskattat) för 2 tjänster.');
  });

  it('märker inte totalen när alla belopp är användarens egna', () => {
    render(<DiagnosisCard advisor={advisor(false)} activeProviderCount={2} />);
    expect(screen.getByText(/Du betalar/)).toHaveTextContent('Du betalar 318 kr/mån för 2 tjänster.');
    expect(screen.queryByText(/uppskattat/)).not.toBeInTheDocument();
  });
});
