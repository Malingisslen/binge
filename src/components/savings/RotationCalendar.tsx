'use client';

import { useEffect, useMemo, useRef } from 'react';
import ProviderDot from '@/components/ui/ProviderDot';
import { formatSwedishDate } from '@/lib/utils';
import { useRotationCalendar, useSavingsLedger } from '@/hooks/useRotationCalendar';
import { useAuth } from '@/hooks/useAuth';

/**
 * BIN-181 — Rotationskalender + sparat-ledger.
 *
 * Turns the advisor's pause *nudge* into a dated plan: "Pausa Viaplay 1 aug,
 * återkom 12 aug — spara ~158 kr", plus a running "sparat i år"-ledger from the
 * realized pause history. Honest framing: Binge can't cancel for you — it dates
 * the plan and (once the reminder function ships) pings you; you click.
 *
 * Time-positioning uses plum (cal-*) per the design system; realized/projected
 * savings use the green season-done token. Renders nothing when there's neither
 * a rotation opportunity nor any saved history.
 */
export default function RotationCalendar() {
  const calendar = useRotationCalendar();
  const ledger = useSavingsLedger();
  const { user, updateRotationSchedule } = useAuth();

  // BIN-181: when the user has opted into rotation reminders, keep the persisted
  // schedule snapshot (which rotationReminderNotify reads) fresh as air dates
  // move — write-on-change only, so it's at most one write per actual change.
  const remindersOn = user?.notificationSettings.rotationReminders ?? false;
  const schedule = useMemo(
    () => calendar.entries.map(e => ({
      providerId: e.providerId,
      shortName: e.shortName,
      cancelDate: e.cancel.date,
      resumeDate: e.resume?.date ?? null,
    })),
    [calendar.entries],
  );
  const scheduleJson = JSON.stringify(schedule);
  const lastPersistedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!remindersOn || calendar.isLoading) return;
    if (scheduleJson === lastPersistedRef.current) return;
    lastPersistedRef.current = scheduleJson;
    void updateRotationSchedule(schedule);
    // schedule is captured via scheduleJson (stable across no-op renders)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remindersOn, calendar.isLoading, scheduleJson, updateRotationSchedule]);

  if (calendar.isLoading) return null;

  const hasEntries = calendar.entries.length > 0;
  const hasLedger = ledger.rotationCount > 0;
  if (!hasEntries && !hasLedger) return null;

  return (
    <div className="mb-[14px]">
      <div className="flex items-baseline justify-between mb-[6px]">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.5px] text-text-muted">Rotationskalender</h2>
        {calendar.totalProjectedSavings > 0 && (
          <span className="text-xxs text-season-done font-semibold">
            Spara ~{calendar.totalProjectedSavings} kr
          </span>
        )}
      </div>

      {hasEntries && (
        <>
          <div className="flex flex-col gap-2">
            {calendar.entries.map(e => (
              <div
                key={e.providerId}
                className="bg-surface border rounded-sm px-3 py-[10px]"
                style={{ borderColor: 'var(--cal-deep)', background: 'var(--cal-soft)' }}
              >
                <div className="flex items-center gap-[6px] mb-[4px]">
                  <ProviderDot color={e.color} size={8} />
                  <span className="text-xs font-semibold text-text-primary">{e.shortName}</span>
                  {e.resume == null ? (
                    <span className="text-xxs text-text-muted">· öppen paus</span>
                  ) : (
                    <span className="text-xxs text-season-done font-semibold ml-auto">
                      spara ~{e.projectedSavings} kr
                    </span>
                  )}
                </div>
                <div className="text-xs text-text-secondary">
                  Pausa <strong className="text-text-primary">{formatSwedishDate(e.cancel.date)}</strong>
                  {e.resume != null ? (
                    <>
                      {' · '}återkom <strong className="text-text-primary">{formatSwedishDate(e.resume.date)}</strong>
                      {' '}<span className="text-text-muted">({e.daysPaused} dagar)</span>
                    </>
                  ) : (
                    <> · inget planerat — <span className="text-text-muted">~{e.cancel.monthlyCost} kr/mån sparat</span></>
                  )}
                </div>
                <div className="text-xxs text-text-muted mt-[3px]">{e.cancel.reason}</div>
              </div>
            ))}
          </div>
          <p className="text-xxs text-text-muted mt-[6px]">
            Binge kan inte säga upp åt dig — vi påminner, du klickar.
          </p>
        </>
      )}

      {hasLedger && (
        <div className="bg-surface border border-border-main rounded-sm px-3 py-[10px] mt-2">
          <div className="text-xs text-text-secondary">
            Du har sparat{' '}
            <strong className="text-season-done">{ledger.savedThisYear} kr</strong> i år genom rotation
            {ledger.rotationCount > 0 && (
              <span className="text-text-muted">
                {' '}· {ledger.rotationCount} {ledger.rotationCount === 1 ? 'rotation' : 'rotationer'}
              </span>
            )}
          </div>
          {ledger.byProvider.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-[6px]">
              {ledger.byProvider.map(p => (
                <span key={p.providerId} className="inline-flex items-center gap-1 text-xxs text-text-muted">
                  {p.shortName} <span className="text-season-done font-semibold">{p.saved} kr</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
