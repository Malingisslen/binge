import { overallHealth, sectionHealth, SECTION_TITLES, type SectionKey } from '../metrics/health';
import type { InsightsData } from '../insights.types';

/** Top box: one sentence that answers "is everything normal?", and what to check if not. */
export function StatusBanner({ data, now }: { data: InsightsData; now: Date | null }) {
  const { ok, problems } = overallHealth(data, now);
  if (ok) {
    return (
      <div className="mt-4 rounded-md border border-success bg-surface px-3 py-2 text-base text-ink" role="status">
        <span className="font-semibold">✓ Allt ser normalt ut.</span>{' '}
        <span className="text-ink-3">Alla delar har färska siffror.</span>
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-md border border-warn-deep bg-warn-soft px-3 py-2 text-base text-warn-ink" role="status">
      <div className="font-semibold">⚠ Något behöver kollas</div>
      <ul className="mt-1 list-disc pl-5 text-sm">
        {problems.map((p) => (
          <li key={p.section}><span className="font-semibold">{SECTION_TITLES[p.section]}:</span> {p.text}</li>
        ))}
      </ul>
    </div>
  );
}

/** Small green/yellow mark beside a section heading. */
export function SectionBadge({ data, section, now }: { data: InsightsData; section: SectionKey; now: Date | null }) {
  const h = sectionHealth(data, section, now);
  return h.ok
    ? <span className="ml-2 text-success normal-case" title="Siffrorna är färska">● OK</span>
    : <span className="ml-2 text-warn-ink normal-case" title={h.problem}>● Kolla</span>;
}
