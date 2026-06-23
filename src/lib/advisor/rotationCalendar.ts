/**
 * BIN-181 — dated rotation calendar.
 *
 * Turns the Streamingrådgivaren's *nudge* ("inget du följer sänds på Viaplay just
 * nu") into a dated, executable plan: "Pausa Viaplay nu, återkom 12 aug när nästa
 * avsnitt kommer — spara ~339 kr". Pure + deterministic (injected `today`), mirrors
 * the style of rotationPlan.ts — the hook layer feeds it per-provider state derived
 * from the existing advisor data (no new TMDB calls).
 *
 * Honest framing: Binge can't cancel for you (no provider API). This is a scheduler
 * + reminders + projected ledger — "vi påminner, du klickar". The projection uses the
 * SAME prorated formula as the realized ledger (round(cost * days / 30)) so the
 * "beräknat" number and the later "sparat" number are directly comparable.
 */

import { nextRenewalDate } from '@/lib/renewal';

export interface RotationProviderState {
  providerId: number;
  providerName: string;
  shortName: string;
  color: string;
  monthlyCost: number;
  /** Faktureringsdag 1–28, eller null om okänd (då pausas "nu"). */
  billingDay: number | null;
  /** ISO yyyy-mm-dd för nästa följda avsnitt/film på tjänsten, eller null (inget planerat). */
  nextAiringDate: string | null;
  /** Sammanhängande tysta veckor framåt (advisor: trailingQuietWeeks). */
  quietWeeks: number;
}

export type RotationEventKind = 'cancel' | 'resume';

export interface RotationEvent {
  kind: RotationEventKind;
  providerId: number;
  providerName: string;
  shortName: string;
  color: string;
  /** ISO yyyy-mm-dd. */
  date: string;
  monthlyCost: number;
  reason: string;
}

export interface RotationCalendarEntry {
  providerId: number;
  providerName: string;
  shortName: string;
  color: string;
  cancel: RotationEvent;
  /** null = öppen paus (inget känt återkomstdatum). */
  resume: RotationEvent | null;
  /** Antal hela dagar pausen varar (0 om öppen). */
  daysPaused: number;
  /** Projicerad besparing i kr, round(monthlyCost * daysPaused / 30). 0 om öppen. */
  projectedSavings: number;
}

export interface RotationCalendar {
  entries: RotationCalendarEntry[];
  totalProjectedSavings: number;
}

export interface RotationCalendarOptions {
  today: Date;
  /** Minsta dödzon (tysta veckor) för att rekommendera paus. Default 3. */
  deadZoneWeeks?: number;
}

const DEFAULT_DEAD_ZONE_WEEKS = 3;

/** ISO yyyy-mm-dd från lokala datumkomponenter (ingen tidszons-drift). */
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parsar yyyy-mm-dd till lokal midnatt. null om ogiltig. */
function parseISODate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function wholeDaysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * Bygger en daterad paus/återkom-kalender från per-provider-läge. En tjänst hamnar
 * i kalendern bara om dess dödzon ≥ deadZoneWeeks. Sorteras på störst besparing först
 * (öppna pauser, vars besparing är okänd, hamnar sist).
 */
export function buildRotationCalendar(
  states: RotationProviderState[],
  opts: RotationCalendarOptions,
): RotationCalendar {
  const today = new Date(opts.today.getFullYear(), opts.today.getMonth(), opts.today.getDate());
  const deadZoneWeeks = opts.deadZoneWeeks ?? DEFAULT_DEAD_ZONE_WEEKS;

  const entries: RotationCalendarEntry[] = [];

  for (const s of states) {
    if (s.quietWeeks < deadZoneWeeks) continue;

    // Pausa innan nästa dragning (annars betalar du en månad du inte använder).
    const cancelDate = s.billingDay != null ? nextRenewalDate(s.billingDay, today) : today;
    const resumeDate = s.nextAiringDate ? parseISODate(s.nextAiringDate) : null;
    const hasGap = resumeDate != null && wholeDaysBetween(cancelDate, resumeDate) > 0;

    const cancel: RotationEvent = {
      kind: 'cancel',
      providerId: s.providerId,
      providerName: s.providerName,
      shortName: s.shortName,
      color: s.color,
      date: toISODate(cancelDate),
      monthlyCost: s.monthlyCost,
      reason: hasGap
        ? `Inget du följer sänds på ${s.shortName} på ${s.quietWeeks} veckor`
        : `Inget planerat på ${s.shortName} just nu`,
    };

    let resume: RotationEvent | null = null;
    let daysPaused = 0;
    let projectedSavings = 0;

    if (hasGap && resumeDate) {
      daysPaused = wholeDaysBetween(cancelDate, resumeDate);
      projectedSavings = Math.round((s.monthlyCost * daysPaused) / 30);
      resume = {
        kind: 'resume',
        providerId: s.providerId,
        providerName: s.providerName,
        shortName: s.shortName,
        color: s.color,
        date: s.nextAiringDate!,
        monthlyCost: s.monthlyCost,
        reason: `Nytt att följa på ${s.shortName}`,
      };
    }

    entries.push({
      providerId: s.providerId,
      providerName: s.providerName,
      shortName: s.shortName,
      color: s.color,
      cancel,
      resume,
      daysPaused,
      projectedSavings,
    });
  }

  entries.sort((a, b) => {
    if (b.projectedSavings !== a.projectedSavings) return b.projectedSavings - a.projectedSavings;
    return a.cancel.date.localeCompare(b.cancel.date);
  });

  const totalProjectedSavings = entries.reduce((sum, e) => sum + e.projectedSavings, 0);
  return { entries, totalProjectedSavings };
}
