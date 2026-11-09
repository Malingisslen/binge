import type { InsightsData, InsightsSource } from '../insights.types';

/** A rollup older than this has missed its daily slot. Shared with the Toolbar. */
export const OVERDUE_AFTER_MS = 30 * 60 * 60 * 1000;

export type SectionKey = 'now' | 'period' | 'engagement' | 'library' | 'ask' | 'traffic';

export interface SectionHealth {
  ok: boolean;
  /** Plain-Swedish reason, only when !ok. */
  problem?: string;
}

const SECTION_SOURCES: Record<SectionKey, InsightsSource[]> = {
  now: ['rollup'],
  period: ['rollup', 'history'],
  engagement: ['events'],
  library: ['rollup'],
  ask: [],
  traffic: ['traffic'],
};

function sourceFailed(data: InsightsData, source: InsightsSource): boolean {
  if (data.failed?.includes(source)) return true;
  switch (source) {
    case 'rollup': return data.rollup === null;
    // events === null before the first counted day is expected, not a failure.
    case 'events': return data.events === null && !!data.eventsSince && data.eventsSince <= data.range.to;
    case 'history': return data.history === null;
    case 'traffic': return data.traffic === null;
  }
}

function rollupOverdue(data: InsightsData, now: Date | null): boolean {
  if (!data.rollup?.computedAt) return false;
  return (now ?? new Date(data.generatedAt)).getTime() - Date.parse(data.rollup.computedAt) > OVERDUE_AFTER_MS;
}

/**
 * Green/yellow per section from data health only: a source that could not be read,
 * a rollup that missed its daily run, or (Fråga Binge) a failed read. No business
 * thresholds — "few users" is never yellow, "the number is missing" always is.
 */
export function sectionHealth(data: InsightsData, section: SectionKey, now: Date | null = null): SectionHealth {
  const failed = SECTION_SOURCES[section].some((s) => sourceFailed(data, s));
  if (failed || (section === 'ask' && data.askBinge === null)) {
    return { ok: false, problem: 'Den här delen kunde inte hämtas just nu.' };
  }
  if ((section === 'now' || section === 'library' || section === 'period') && rollupOverdue(data, now)) {
    return { ok: false, problem: 'Siffrorna är gamla: den dagliga uppdateringen har inte körts.' };
  }
  if ((section === 'now' || section === 'period' || section === 'library') && data.rollup?.partial) {
    return { ok: false, problem: 'Några siffror är ofullständiga i den senaste beräkningen.' };
  }
  return { ok: true };
}

export const SECTION_TITLES: Record<SectionKey, string> = {
  now: 'Just nu',
  period: 'Nya konton',
  engagement: 'Engagemang',
  library: 'Biblioteket',
  ask: 'Fråga Binge',
  traffic: 'Besök',
};

export function overallHealth(data: InsightsData, now: Date | null = null): { ok: boolean; problems: { section: SectionKey; text: string }[] } {
  const problems = (Object.keys(SECTION_TITLES) as SectionKey[]).flatMap((section) => {
    const h = sectionHealth(data, section, now);
    return h.ok ? [] : [{ section, text: h.problem ?? '' }];
  });
  return { ok: problems.length === 0, problems };
}
