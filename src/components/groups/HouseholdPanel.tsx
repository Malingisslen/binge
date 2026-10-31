'use client';

import { useMemo, useState } from 'react';
import { useGroupHousehold } from '@/hooks/useGroupHousehold';
import { useMountTime } from '@/hooks/useMountTime';
import { aggregateHousehold, HOUSEHOLD_STALE_DAYS } from '@/lib/advisor/householdAggregate';
import { formatKr } from '@/lib/formatKr';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Button } from '@/components/ui/Button';
import { cardClass } from '@/components/ui/Card';
import HouseholdConsent from '@/components/groups/HouseholdConsent';

// BIN-184 — "Hushåll"-panelen i gruppens vänsterspalt. Opt-in via en explicit
// samtyckesvy (Legal-krav: vad som delas, vem som ser — nuvarande OCH framtida
// medlemmar — syfte, återkallelse OCH den tekniska läs-luckan, ADR 0010).
// Share-to-see: bara medlemmar som själva delar ser vyn (rules-gaten driver
// 'gated'-läget). Copy:n antyder ALDRIG kontodelning (ADR 0010: tyst).

const dateFmt = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' });

export default function HouseholdPanel({ groupId }: { groupId: string }) {
  const { status, contributions, optIn, optOut, busy, ready, needsReshare } = useGroupHousehold(groupId);
  const nowMs = useMountTime();
  const [consentOpen, setConsentOpen] = useState(false);
  const showConsent = consentOpen && (status === 'gated' || (status === 'active' && needsReshare));

  const overview = useMemo(
    () => (nowMs != null && status === 'active' ? aggregateHousehold(contributions, new Date(nowMs)) : null),
    [contributions, nowMs, status],
  );

  return (
    <div className={cardClass()}>
      <Eyebrow className="px-3 py-1.5 border-b border-rule-2">
        Hushåll
      </Eyebrow>

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
          <Button type="button" variant="acc" size="sm" className="w-full" onClick={() => setConsentOpen(true)}>
            Dela mina kostnader…
          </Button>
        </div>
      )}

      {showConsent && (
        <HouseholdConsent
          reshare={status === 'active'}
          busy={busy}
          ready={ready}
          onShare={() => { void optIn().then(() => setConsentOpen(false)).catch(() => {}); }}
          onCancel={() => setConsentOpen(false)}
        />
      )}

      {status === 'active' && needsReshare && !consentOpen && (
        // ADR 0026: en delare från före "nytt inom 30 dagar" räknas som okänd tills
        // hen aktivt delar om under den nya texten.
        <div className="px-3 py-2 space-y-2 border-b border-rule-2">
          <p className="text-xxs text-ink-2 leading-relaxed">
            Hushållet kan nu se vem som har något nytt inom 30 dagar. Du har inte
            delat det ännu.
          </p>
          <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => setConsentOpen(true)}>
            Läs och dela igen…
          </Button>
        </div>
      )}

      {status === 'active' && overview && !showConsent && (
        <div className="px-3 py-2 space-y-2">
          <div>
            <span className="text-xl font-bold text-ink">{formatKr(overview.totalKr)} kr</span>
            <span className="text-xxs text-ink-3"> /mån sammanlagt · {overview.memberCount} delar</span>
          </div>

          {overview.rows.length > 0 ? (
            <ul className="space-y-1">
              {overview.rows.map(row => (
                <li key={row.providerId} className="text-xxs leading-relaxed">
                  <span className="text-ink font-semibold">{row.name}</span>
                  <span className="text-ink-2">
                    {' '}· betalas av {row.paidByCount} · {formatKr(row.totalKr)} kr
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
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { void optOut(); }}>
              Sluta dela
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
