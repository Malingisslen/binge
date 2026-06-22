/**
 * BIN-92 — prenumerations-rotationsplanerare.
 *
 * Kraft-användarens pengamanöver är att rotera EN tjänst i taget: "ta Max i
 * juni, säg upp, ta Viaplay i juli". Den här rena funktionen tar per-provider-
 * backlog + månadskostnad (härlett ur Streamingrådgivarens befintliga data —
 * inga nya TMDB-anrop) och lägger ut en månad-för-månad-plan som maximerar
 * uppröjd backlog per krona inom en valfri månadsbudget.
 *
 * Modellen är medvetet enkel och deterministisk (lätt att testa + förklara):
 * en betald tjänst per månad (den kanoniska "rotera en i taget"-rörelsen),
 * gratistjänster ligger alltid kvar. Greedy på värdetäthet (backlog/kr).
 */

export interface RotationProviderInput {
  providerId: number;
  providerName: string;
  shortName: string;
  color: string;
  monthlyCost: number;
  /** Osedd content kopplad till tjänsten: osedda avsnitt-serier + vill-se-titlar. */
  backlogCount: number;
  isFree: boolean;
}

export interface RotationMonth {
  /** 0 = denna månad, 1 = nästa, … */
  monthOffset: number;
  /** Tjänsten att abonnera på den månaden; null = lucka (inget kvar/får inte plats). */
  provider: RotationProviderInput | null;
  cost: number;
  backlogCleared: number;
}

export interface RotationPlanResult {
  months: RotationMonth[];
  /** Summa kostnad över hela horisonten (en tjänst i taget → kostnad per aktiv månad). */
  totalCost: number;
  totalBacklogCleared: number;
  /** Gratistjänster med backlog — ligger alltid kvar, ingen rotation behövs. */
  alwaysFree: RotationProviderInput[];
  /** Betalda tjänster med backlog som inte fick plats inom horisonten. */
  unscheduled: RotationProviderInput[];
}

export interface RotationPlanOptions {
  /** Antal månader att planera. Default 4. */
  horizonMonths?: number;
  /** Max kr/månad. null = ingen gräns (default). En tjänst dyrare än budgeten hoppas över. */
  monthlyBudget?: number | null;
}

const DEFAULT_HORIZON = 4;

/** Värdetäthet: hur mycket backlog per krona. Gratis hanteras separat. */
function valueDensity(p: RotationProviderInput): number {
  return p.monthlyCost > 0 ? p.backlogCount / p.monthlyCost : 0;
}

export function rotationPlan(
  inputs: RotationProviderInput[],
  opts: RotationPlanOptions = {},
): RotationPlanResult {
  const horizonMonths = Math.max(1, opts.horizonMonths ?? DEFAULT_HORIZON);
  const budget = opts.monthlyBudget ?? null;

  const alwaysFree = inputs.filter(p => p.isFree && p.backlogCount > 0);

  // Kandidater: betalda tjänster med faktisk backlog. Rangordna på värdetäthet
  // (backlog/kr), tie-break på störst backlog så en jämn täthet ändå prioriterar
  // den med mest att röja.
  const candidates = inputs
    .filter(p => !p.isFree && p.monthlyCost > 0 && p.backlogCount > 0)
    .filter(p => budget == null || p.monthlyCost <= budget)
    .sort((a, b) => {
      const d = valueDensity(b) - valueDensity(a);
      return d !== 0 ? d : b.backlogCount - a.backlogCount;
    });

  // Tjänster med backlog men som inte är budgetgångbara (för dyra) räknas som
  // oschemalagda så de inte tyst försvinner.
  const overBudget = inputs.filter(
    p => !p.isFree && p.monthlyCost > 0 && p.backlogCount > 0 && budget != null && p.monthlyCost > budget,
  );

  const months: RotationMonth[] = [];
  let totalCost = 0;
  let totalBacklogCleared = 0;

  for (let m = 0; m < horizonMonths; m++) {
    const provider = candidates[m] ?? null;
    if (provider) {
      months.push({ monthOffset: m, provider, cost: provider.monthlyCost, backlogCleared: provider.backlogCount });
      totalCost += provider.monthlyCost;
      totalBacklogCleared += provider.backlogCount;
    } else {
      months.push({ monthOffset: m, provider: null, cost: 0, backlogCleared: 0 });
    }
  }

  // Kandidater bortom horisonten + över-budget-tjänster = oschemalagda.
  const unscheduled = [...candidates.slice(horizonMonths), ...overBudget];

  return { months, totalCost, totalBacklogCleared, alwaysFree, unscheduled };
}
