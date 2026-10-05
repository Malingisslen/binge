import type { MetricKey, Explanation } from './types';

/**
 * ExplainDrawer copy per metric. Not every metric needs a long explanation —
 * the drawer falls back to the label when a key is absent here.
 */
export const EXPLANATIONS: Partial<Record<MetricKey, Explanation>> = {
  activeUsers7d: {
    whatIsIt: 'Inloggade konton vars inloggning förnyats de senaste 7 dagarna — ett närmevärde för att ha öppnat Binge, inte ett exakt mått.',
    howCalculated: 'Räknas i rollupen ur Firebase Auths egen tidsstämpel för senaste inloggning eller tokenförnyelse. En flik som står öppen i bakgrunden räknas, en session som bara används offline kan missas. Anonyma Tillsammans-gäster räknas inte. Följer inte datumväljaren.',
    whyImportant: 'Visar om folk kommer tillbaka.',
    source: 'Firebase Auth (rollup)',
  },
  activeUsers30d: {
    whatIsIt: 'Inloggade konton vars inloggning förnyats de senaste 30 dagarna — samma närmevärde som 7-dagarssiffran.',
    howCalculated: 'Samma klocka som 7-dagarssiffran, med ett 30-dagarsfönster. Följer inte datumväljaren.',
    whyImportant: 'Kvoten mellan 7- och 30-dagarssiffran visar hur stor del av månadens användare som är veckovana.',
    source: 'Firebase Auth (rollup)',
  },
  signupLandingPages: {
    whatIsIt: 'Vilken sida de som registrerade sig kom in på, och hur många som totalt kom in där.',
    howCalculated: 'Kräver besöksdata per sida. Binge räknar händelser, inte besök, så måttet har ingen källa.',
    whyImportant: 'Visar vilka sökträffar och delade länkar som faktiskt blir konton.',
    source: 'Ingen källa',
  },
  providerClicks: {
    whatIsIt: 'Klick från en titelsida ut till en tjänst som Netflix, SF Anytime eller Viaplay.',
    howCalculated: 'Händelsen provider_clicked, summerad över de dagar i intervallet som har en räkning.',
    whyImportant: 'Det är steget där Binge har gjort sitt jobb, och det som en framtida affiliate-intäkt skulle hänga på.',
    source: 'Firestore (recordEvent-räknare)',
  },
  providerClicksByType: {
    whatIsIt: 'Klicken ut till tjänster, uppdelade på abonnemang, hyra, köpa och gratis.',
    howCalculated: 'Händelsen provider_clicked grupperad på offerType.',
    whyImportant: 'Visar om folk mest letar efter var något ingår eller var det går att hyra.',
    source: 'Firestore (recordEvent-räknare)',
  },
  shareClicks: {
    whatIsIt: 'Tryck på delningsknappen på en titel, en lista eller en profil.',
    howCalculated: 'Händelsen share_clicked, summerad över de dagar i intervallet som har en räkning.',
    whyImportant: 'Delade länkar är hur Binge sprids utan annonser.',
    source: 'Firestore (recordEvent-räknare)',
  },
  priceCheckTotals: {
    whatIsIt: 'Gånger ett val i streamingkalkylatorn eller startsidans demo gav en summa.',
    howCalculated: 'Händelsen price_check_total_shown, högst en gång per sidvisning.',
    whyImportant: 'Visar om priskollen används, och är början på tratten mot ett konto.',
    source: 'Firestore (recordEvent-räknare)',
  },
  pageViews: {
    whatIsIt: 'Antal sidvisningar.',
    howCalculated: 'Kräver besöksdata. Binge räknar händelser, inte besök, så måttet har ingen källa.',
    whyImportant: 'Visar hur mycket sajten används totalt.',
    source: 'Ingen källa',
  },
  totalUsers: {
    whatIsIt: 'Totalt antal registrerade användarkonton.',
    howCalculated: 'Antalet dokument i users-collectionen vid senaste rollup-körningen.',
    whyImportant: 'Den enklaste tillväxtkurvan — total bas av konton.',
    source: 'Firestore (rollup)',
  },
  newUsers: {
    whatIsIt: 'Antal nya registreringar under perioden.',
    howCalculated: 'Nettoökningen av users-dokument mellan baslinjens ögonblicksbild och den senaste rollupen, aldrig under noll.',
    whyImportant: 'Visar tillväxttakten, inte bara totalen.',
    source: 'Firestore (rollup)',
  },
  onboardingFunnel: {
    whatIsIt: 'Hur långt nya användare tar sig i onboarding-flödet.',
    howCalculated: 'Händelsen onboarding_completed, grupperad på step_reached.',
    whyImportant: 'Avslöjar var folk hoppar av — störst tapp = störst möjlighet.',
    source: 'Firestore (recordEvent-räknare)',
  },
  statusDistribution: {
    whatIsIt: 'Hur watchlist-titlar fördelar sig på status.',
    howCalculated: 'Räknas över alla användares watchlist-dokument i rollupen.',
    whyImportant: 'Visar om appen används för att planera (vill se) eller logga (sedd).',
    source: 'Firestore (rollup)',
  },
  ratingsHistogram: {
    whatIsIt: 'Fördelning av satta betyg (1–5 stjärnor).',
    howCalculated: 'Betyg på 0.5–5-skalan avrundas till närmaste heltalsstjärna och räknas per bucket (1–5).',
    whyImportant: 'Indikerar om betygsskalan används brett eller klumpas ihop.',
    source: 'Firestore (rollup)',
  },
  avgSessionDuration: {
    whatIsIt: 'Genomsnittlig sessionslängd på sajten.',
    howCalculated: 'Kräver besöksdata. Binge räknar händelser, inte besök, så måttet har ingen källa.',
    whyImportant: 'Längre sessioner antyder djupare engagemang.',
    source: 'Ingen källa',
  },
  askZeroRate: {
    whatIsIt: 'Andel "Fråga Binge"-sökningar som gav noll träffar.',
    howCalculated: 'Tomma sökningar delat med antal slutförda sökningar under perioden.',
    whyImportant: 'Den tystaste misslyckandet — användaren fick inget och lämnar. Hög andel = filter krockar eller katalogen saknar det folk frågar efter.',
    source: 'Firestore (recordAskBinge-räknare)',
  },
  askStrandingFilters: {
    whatIsIt: 'Vilka filterkombinationer som oftast ger tomma träffar.',
    howCalculated: 'Per kombination (t.ex. Årtionde + Betyg) räknas hur många sökningar som gav noll, sorterat fallande.',
    whyImportant: 'Pekar exakt på vilka kombinationer som behöver mjukas upp eller auto-relaxas.',
    source: 'Firestore (recordAskBinge-räknare)',
  },
  askRemovedChips: {
    whatIsIt: 'Vilka tolkningar användare oftast tar bort.',
    howCalculated: 'Varje gång en tolknings-chip raderas räknas dess filtertyp; sorterat fallande.',
    whyImportant: 'En borttagning är ett "du gissade fel"-kvitto — dominerar en filtertyp så övertriggar regeln.',
    source: 'Firestore (recordAskBinge-räknare)',
  },
};
