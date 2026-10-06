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
    expect(screen.getByTestId('money-figure')).toHaveTextContent(/Per månad\s*318 kr/);
    expect(screen.getByTestId('money-figure')).toHaveTextContent(/Per år, uppskattat\s*3 816 kr/);
    expect(screen.getByText(/Du har/)).toHaveTextContent('Du har 2 tjänster.');
  });

  it('märker inte totalen när alla belopp är användarens egna', () => {
    render(<DiagnosisCard advisor={advisor(false)} activeProviderCount={2} />);
    expect(screen.getByTestId('money-figure')).toHaveTextContent(/Per år\s*3 816 kr/);
    expect(screen.queryByText(/uppskattat/)).not.toBeInTheDocument();
  });

  it('visar ingen summa när inga tjänster kostar något', () => {
    render(<DiagnosisCard advisor={{ ...advisor(false), totalMonthlyCost: 0 }} activeProviderCount={1} />);
    expect(screen.queryByTestId('money-figure')).toBeNull();
    expect(screen.getByText(/Du har/)).toHaveTextContent('Du har 1 tjänst.');
  });
});

describe('DiagnosisCard — pausgolvet', () => {
  it('ber om fler titlar i stället för att föreslå en paus', () => {
    const a = {
      totalMonthlyCost: 169,
      totalMonthlyCostEstimated: false,
      primaryAction: { kind: 'needs-library', titleCount: 1, minTitles: 3 },
    } as unknown as AdvisorResult;
    render(<DiagnosisCard advisor={a} activeProviderCount={1} />);
    // The amount is the receipt figure above the sentence (BIN-1446), the sentence counts the services.
    expect(screen.getByTestId('money-figure')).toHaveTextContent(/Per månad\s*169 kr/);
    expect(screen.getByText(/Du har 1 tjänst/)).toHaveTextContent(
      'Du har 1 tjänst. Lägg till det du följer, så kan Binge räkna ut vad du kan pausa. Binge behöver minst 3 titlar i Följer eller Vill se, du har 1.',
    );
    expect(screen.queryByText(/kan pausas/)).not.toBeInTheDocument();
  });
});
