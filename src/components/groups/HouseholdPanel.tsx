'use client';

import { useMemo, useState } from 'react';
import { useGroupHousehold } from '@/hooks/useGroupHousehold';
import { useMountTime } from '@/hooks/useMountTime';
import { aggregateHousehold, HOUSEHOLD_STALE_DAYS } from '@/lib/advisor/householdAggregate';

// BIN-184 — "Hushåll"-panelen i gruppens vänsterspalt. Aggregat-ENDAST i UI:t
// ("Disney+ betalas av 2 av er"), aldrig per person. Opt-in via en explicit
// samtyckesvy (Legal-krav: vad som delas, vem som ser — nuvarande OCH framtida
// medlemmar — syfte, återkallelse OCH den tekniska läs-luckan, ADR 0010).
// Share-to-see: bara medlemmar som själva delar ser vyn (rules-gaten driver
// 'gated'-läget). Copy:n antyder ALDRIG kontodelning (ADR 0010: tyst).

const dateFmt = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' });

export default function HouseholdPanel({ groupId }: { groupId: string }) {
  const { status, contributions, optIn, optOut, busy, ready } = useGroupHousehold(groupId);
  const nowMs = useMountTime();
  const [consentOpen, setConsentOpen] = useState(false);

  const overview = useMemo(
    () => (nowMs != null && status === 'active' ? aggregateHousehold(contributions, new Date(nowMs)) : null),
    [contributions, nowMs, status],
  );

  return (
    <div className="bg-surface border border-rule rounded-sm">
      <div className="px-3 py-[6px] border-b border-rule-2 text-[10px] uppercase tracking-[0.5px] text-ink-3 font-semibold">
        Hushåll
      </div>

      {status === 'loading' && (
        // Skeleton-rad, inte bar "Laddar…"-text (design-guarden i consistency.test.ts).
        <div className="px-3 py-2 space-y-1" aria-hidden="true">
          <div className="h-3 w-2/3 bg-bg-2 rounded-sm animate-pulse" />
          <div className="h-3 w-1/2 bg-bg-2 rounded-sm animate-pulse" />
        </div>
      )}

      {status === 'error' && (
        <div className="px-3 py-2 text-xxs text-danger-ink">
          Kunde inte läsa hushållsdatan just nu. Ladda om sidan för att försöka igen.
        </div>
      )}

      {status === 'gated' && !consentOpen && (
        <div className="px-3 py-2 space-y-2">
          <p className="text-xxs text-ink-2 leading-relaxed">
            Se vad hushållet betalar för streaming sammanlagt — vilka tjänster
            som betalas dubbelt och vilka ingen använder.
          </p>
          <p className="text-xxs text-ink-3">
            Bara medlemmar som själva delar ser hushållsvyn.
          </p>
          <button type="button" className="btn btn-primary btn-sm w-full" onClick={() => setConsentOpen(true)}>
            Dela mina kostnader…
          </button>
        </div>
      )}

      {status === 'gated' && consentOpen && (
        <div className="px-3 py-2 space-y-2">
          {/* Samtyckesvyn — bindande copy (Legal #1/#3 + ADR 0010). */}
          <p className="text-xs font-bold text-ink">Dela dina streamingkostnader med gruppen?</p>
          <ul className="text-xxs text-ink-2 leading-relaxed list-disc pl-4 space-y-1">
            <li>
              <span className="font-semibold">Det här delas:</span> vilka tjänster du har,
              vad du betalar per tjänst (inklusive kampanjpris och dess slutdatum) och
              vilka tjänster som har titlar i din backlog. Aldrig vad du tittar på.
            </li>
            <li>
              <span className="font-semibold">Vilka ser det:</span> nuvarande och framtida
              medlemmar i den här gruppen som själva delar sina kostnader.
            </li>
            <li>
              <span className="font-semibold">Syfte:</span> en sammanlagd hushållsbild —
              totalkostnad, dubbelbetalda tjänster och tjänster utan användning.
            </li>
            <li>
              I appen visas bara totalsiffror — men tekniskt kan delande
              gruppmedlemmar nå din enskilda lista.
            </li>
            <li>
              Du kan sluta dela när som helst; din data raderas då direkt.
            </li>
          </ul>
          <div className="flex items-center gap-2 pt-1">
            {/* disabled tills payloaden är byggd — klick får aldrig tyst no-op:a */}
            <button type="button" className="btn btn-primary btn-sm flex-1" disabled={busy || !ready} onClick={() => { void optIn(); }}>
              Dela
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setConsentOpen(false)}>
              Avbryt
            </button>
          </div>
        </div>
      )}

      {status === 'active' && overview && (
        <div className="px-3 py-2 space-y-2">
          <div>
            <span className="text-[17px] font-bold text-ink">{overview.totalKr} kr</span>
            <span className="text-xxs text-ink-3"> /mån sammanlagt · {overview.memberCount} delar</span>
          </div>

          {overview.rows.length > 0 ? (
            <ul className="space-y-1">
              {overview.rows.map(row => (
                <li key={row.providerId} className="text-xxs leading-relaxed">
                  <span className="text-ink font-semibold">{row.name}</span>
                  <span className="text-ink-2">
                    {' '}· betalas av {row.paidByCount} · {row.totalKr} kr
                  </span>
                  {row.unknownCostCount > 0 && (
                    <span className="text-ink-3"> · {row.unknownCostCount} med okänd kostnad</span>
                  )}
                  {row.zeroCostCount > 0 && (
                    // BIN-514: medlemmar på 0 kr (gratis/reklam eller nollställt) — inte spend.
                    <span className="text-ink-3"> · {row.zeroCostCount} utan kostnad</span>
                  )}
                  {row.deadWeight && (
                    // danger, inte saffran: "pengar slösas" är en varning, inte en CTA
                    // (två-accentregeln; samma mönster som ServiceValueCard).
                    <div className="text-danger font-semibold">Ingen i hushållet har backlog här.</div>
                  )}
                  {row.activityUnknown && (
                    <div className="text-ink-3">
                      Osäkert underlag — någons data är äldre än {HOUSEHOLD_STALE_DAYS} dagar.
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xxs text-ink-3">Inga betalda tjänster delade ännu.</p>
          )}

          <div className="pt-1 border-t border-rule-2 space-y-1">
            {overview.oldestUpdatedAt != null && (
              <div className="text-xxs text-ink-3">
                Äldsta uppgift: {dateFmt.format(overview.oldestUpdatedAt)}
                {overview.staleCount > 0 && ` · ${overview.staleCount} kan vara inaktuell${overview.staleCount > 1 ? 'a' : ''}`}
              </div>
            )}
            <div className="text-xxs text-ink-3">Bara medlemmar som delar ser detta.</div>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { void optOut(); }}>
              Sluta dela
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
