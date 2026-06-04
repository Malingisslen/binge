import type { MetricKey, Explanation } from './types';

/**
 * ExplainDrawer copy per metric. Not every metric needs a long explanation —
 * the drawer falls back to the label when a key is absent here.
 */
export const EXPLANATIONS: Partial<Record<MetricKey, Explanation>> = {
  totalUsers: {
    whatIsIt: 'Totalt antal registrerade användarkonton.',
    howCalculated: 'Antalet dokument i users-collectionen vid senaste rollup-körningen.',
    whyImportant: 'Den enklaste tillväxtkurvan — total bas av konton.',
    source: 'Firestore (rollup)',
  },
  newUsers: {
    whatIsIt: 'Antal nya registreringar under perioden.',
    howCalculated: 'Plausible-målet signed_up, summerat över valt datumintervall.',
    whyImportant: 'Visar tillväxttakten, inte bara totalen.',
    source: 'Plausible (live)',
  },
  onboardingFunnel: {
    whatIsIt: 'Hur långt nya användare tar sig i onboarding-flödet.',
    howCalculated: 'Plausible-målet onboarding_completed, grupperat på step_reached.',
    whyImportant: 'Avslöjar var folk hoppar av — störst tapp = störst möjlighet.',
    source: 'Plausible (live)',
  },
  statusDistribution: {
    whatIsIt: 'Hur watchlist-titlar fördelar sig på status.',
    howCalculated: 'Räknas över alla användares watchlist-dokument i rollupen.',
    whyImportant: 'Visar om appen används för att planera (vill se) eller logga (sedd).',
    source: 'Firestore (rollup)',
  },
  ratingsHistogram: {
    whatIsIt: 'Fördelning av satta betyg 1–10.',
    howCalculated: 'Betyg avrundas till närmaste heltal och räknas per bucket.',
    whyImportant: 'Indikerar om betygsskalan används brett eller klumpas ihop.',
    source: 'Firestore (rollup)',
  },
  avgSessionDuration: {
    whatIsIt: 'Genomsnittlig sessionslängd på sajten.',
    howCalculated: 'Plausibles visit_duration-mått för perioden.',
    whyImportant: 'Längre sessioner antyder djupare engagemang.',
    source: 'Plausible (live)',
  },
};
