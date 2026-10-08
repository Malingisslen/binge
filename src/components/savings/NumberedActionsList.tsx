'use client';

import { formatKr } from '@/lib/formatKr';
import Link from 'next/link';
import { addDaysFromToday, pluralSv } from '@/lib/utils';
import type { AdvisorResult, PrimaryAction } from '@/types';
import { cardClass } from '@/components/ui/Card';
import { buttonClass } from '@/components/ui/Button';
import { badgeClass } from '@/components/ui/Badge';

// "1. Slutför · 2. Pausa när klar · 3. Överväg" — den numrerade rådgivar-
// listan från mockup E. Steg 1 är aktiv (CTA-knapp), steg 2+3 är passiva
// (grå opacity + outline-eller-pill).
//
// Vi härleder upp till 3 steg från advisor-state. Edge: om advisor är i
// idle visar vi bara en rad "Inget att göra just nu".

interface Props {
  advisor: AdvisorResult;
  onPauseProvider: (providerId: number, resumeAt: string | null) => void;
  onShowSubscribeRows?: () => void;
}

interface Step {
  number: number;
  title: string;
  desc?: React.ReactNode;
  active: boolean;
  // Active steg får CTA-knapp. Passiva steg får antingen en outline-CTA
  // (för "Visa →") eller en badge (för "Spar X kr/mån"-info).
  cta?: { label: string; href?: string; onClick?: () => void };
  badge?: { label: string };
}

interface BuildStepsContext {
  onPauseActive: (providerId: number, resumeAt: string | null) => void;
}

const CARD_BASE = cardClass('grid grid-cols-[36px_1fr_auto] gap-3 px-4 py-3 items-center mb-1.5');
const NUM_BASE = 'text-3xl leading-none text-center font-light';
const CTA_PRIMARY = buttonClass({ variant: 'acc', size: 'sm', className: 'no-underline whitespace-nowrap' });
const CTA_GHOST = buttonClass({ variant: 'ghost', size: 'sm', className: 'no-underline whitespace-nowrap' });
const BADGE_GREEN = badgeClass('success', 'whitespace-nowrap');

function buildSteps(advisor: AdvisorResult, ctx: BuildStepsContext): Step[] {
  const steps: Step[] = [];
  const primary = advisor.primaryAction;

  // Steg 1: primaryAction (aktiv)
  steps.push(stepFromPrimary(primary, ctx));

  // Steg 2: catchup-then-pause när primaryAction är catchup. Den naturliga
  // följden är "och pausa när du är klar" om det provider:s status
  // egentligen är pausvärd när användaren är ikapp.
  if (primary.kind === 'catchup') {
    steps.push({
      number: 2,
      title: `Pausa ${primary.providerName} när du är klar`,
      desc: 'Inga andra serier från din Följer eller Vill se ligger där de närmaste 60 dagarna.',
      active: false,
      badge: { label: `Spar ${formatKr(primary.monthlyCost)} kr/mån` },
    });
  } else if (primary.kind === 'pause' && advisor.secondaryAction?.kind === 'catchup') {
    // Vid pause-primary kan secondaryAction vara catchup — vi visar den
    // som "samtidigt: titta klart på X".
    const sec = advisor.secondaryAction;
    steps.push({
      number: 2,
      title: `Titta klart på ${sec.providerName}`,
      desc: `Du ligger efter på ${pluralSv(sec.unfinishedCount, 'serie', 'serier')} här.`,
      active: false,
      cta: { label: `Visa (${sec.unfinishedCount})`, href: `/my/series?provider=${sec.providerId}&status=behind` },
    });
  }

  // Steg 3: subscribe-rådgivning (titlar på tjänster du inte har)
  const totalSubscribeTitles = advisor.subscribeAdvice.reduce((sum, sa) => sum + sa.shows.length, 0);
  if (totalSubscribeTitles > 0) {
    const breakdown = advisor.subscribeAdvice
      .slice(0, 4)
      .map(sa => `${sa.shortName} har ${pluralSv(sa.shows.length, 'serie', 'serier')}`)
      .join(' · ');
    steps.push({
      number: steps.length + 1,
      title: `Överväg: ${totalSubscribeTitles} titlar på tjänster du inte har`,
      desc: breakdown,
      active: false,
      cta: { label: 'Visa →' },
    });
  }

  return steps;
}

function stepFromPrimary(action: PrimaryAction, ctx: BuildStepsContext): Step {
  switch (action.kind) {
    case 'pause': {
      const defaultResume = action.nextAirDate ?? addDaysFromToday(30);
      return {
        number: 1,
        title: `Pausa ${action.providerName} — spar ${formatKr(action.monthlyCost)} kr/mån`,
        desc: action.nextAirDate
          ? 'Inget från din Följer eller Vill se ligger där tills återupptags-datumet.'
          : 'Inget från din Följer eller Vill se ligger där de närmaste 60 dagarna.',
        active: true,
        cta: {
          label: 'Pausa →',
          onClick: () => ctx.onPauseActive(action.providerId, defaultResume),
        },
      };
    }
    case 'catchup':
      return {
        number: 1,
        title: `Slutför ${pluralSv(action.unfinishedCount, `${action.providerName}-serie`, `${action.providerName}-serier`)}`,
        desc: 'Avsluta dem innan nästa pausfönster för att slippa betala för ett abonnemang du inte utnyttjar.',
        active: true,
        cta: { label: `Visa (${action.unfinishedCount})`, href: `/my/series?provider=${action.providerId}&status=behind` },
      };
    case 'subscribe':
      return {
        number: 1,
        title: `Prenumerera på ${action.providerName}`,
        desc: `${pluralSv(action.showCount, 'serie du följer', 'serier du följer')} har nya avsnitt inom 60 dagar.`,
        active: true,
        cta: { label: 'Visa titlar' },
      };
    case 'needs-library':
      return {
        number: 1,
        title: 'Lägg till det du följer',
        desc: `Binge behöver minst ${action.minTitles} titlar i Följer eller Vill se för att räkna.`,
        active: true,
        cta: { label: 'Utforska serier', href: '/series/' },
      };
    case 'idle':
    default:
      return {
        number: 1,
        title: 'Inget att göra just nu',
        desc: 'Allt är välbalanserat just nu.',
        active: true,
      };
  }
}

export default function NumberedActionsList({ advisor, onPauseProvider, onShowSubscribeRows }: Props) {
  const steps = buildSteps(advisor, { onPauseActive: onPauseProvider });

  return (
    <div className="mb-3.5">
      {steps.map((step, idx) => (
        <div
          key={`${step.number}-${idx}`}
          className={`${CARD_BASE} ${step.active ? '' : 'opacity-65'}`}
        >
          <div className={`${NUM_BASE} ${step.active ? 'text-acc-deep font-semibold' : 'text-ink-3'}`}>
            {step.number}
          </div>
          <div className="min-w-0">
            <div className="text-base font-semibold text-ink">{step.title}</div>
            {step.desc && (
              <div className="text-xs text-ink-3 mt-0.5 truncate">{step.desc}</div>
            )}
          </div>
          <div className="shrink-0">
            {step.cta && (
              step.cta.href ? (
                <Link href={step.cta.href} className={step.active ? CTA_PRIMARY : CTA_GHOST}>
                  {step.cta.label}
                </Link>
              ) : (
                <button onClick={() => { onShowSubscribeRows?.(); step.cta?.onClick?.(); }} className={step.active ? CTA_PRIMARY : CTA_GHOST}>
                  {step.cta.label}
                </button>
              )
            )}
            {!step.cta && step.badge && (
              <span className={BADGE_GREEN}>{step.badge.label}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
