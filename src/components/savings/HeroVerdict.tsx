'use client';

import { useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import { formatKr } from '@/lib/formatKr';
import { formatSwedishDate, pluralSv } from '@/lib/utils';
import { heroVerdict, type HeroVerdict as Hero } from '@/lib/advisor/verdicts';
import type { SavingsTabId } from '@/lib/advisor/savingsTabs';
import type { AdvisorResult } from '@/types';
import { Button, buttonClass } from '@/components/ui/Button';
import { cardClass } from '@/components/ui/Card';
import { commitmentLine } from '@/components/savings/BundleArbitrageCard';
import { Eyebrow, eyebrowClass } from '@/components/ui/Eyebrow';

interface Props {
  advisor: AdvisorResult;
  onPause: (providerId: number, resumeAt: string) => void;
  onOpenTab: (tab: SavingsTabId) => void;
  /** Opens and scrolls to the unowned-service titles; the same route the numbered steps take. */
  onShowSubscribeRows: () => void;
}

interface Answer {
  sentence: ReactNode;
  /** Plum line: the date the answer is about. Time is plum, the action is saffron. */
  when?: string;
  // Bindning och startavgift must sit next to a bundle's saving claim (legal condition), same wording as the bundle card.
  terms?: string;
  action?: ReactNode;
  why: ReactNode[];
}

function answerFor(hero: Hero, advisor: AdvisorResult, p: Props): Answer {
  switch (hero.kind) {
    case 'pause': {
      const why: ReactNode[] = [
        hero.resumeIsAirDate
          ? `Inget från din Följer eller Vill se ligger på ${hero.providerName} före ${formatSwedishDate(hero.resumeAt)}, då det kommer något nytt.`
          : `Inget från din Följer eller Vill se ligger på ${hero.providerName} de närmaste 60 dagarna.`,
      ];
      if (advisor.monthlySavings > hero.monthlyCost) {
        why.push(`Sammanlagt kan ${formatKr(advisor.monthlySavings)} kr/mån sparas på tjänster du inte använder just nu.`);
      }
      return {
        sentence: `Pausa ${hero.providerName} och spara ${formatKr(hero.monthlyCost)} kr/mån.`,
        when: `Återupptas ${formatSwedishDate(hero.resumeAt)}`,
        action: (
          <Button type="button" variant="acc" onClick={() => p.onPause(hero.providerId, hero.resumeAt)}>
            Pausa till {formatSwedishDate(hero.resumeAt)}
          </Button>
        ),
        why,
      };
    }
    case 'bundle': {
      const s = hero.suggestion;
      return {
        sentence: `Samla ${s.replacedNames.join(' och ')} i ${s.bundle.name} och spara ${formatKr(s.savingKr)} kr/mån.`,
        action: (
          <Button type="button" variant="acc" onClick={() => p.onOpenTab('paket')}>Visa paketet</Button>
        ),
        terms: commitmentLine(s) ?? undefined,
        why: [`Du betalar ${formatKr(s.currentKr)} kr/mån för tjänsterna var för sig. Paketet kostar ${formatKr(s.bundleKr)} kr/mån.`],
      };
    }
    case 'catchup':
      return {
        sentence: `Titta klart på ${pluralSv(hero.unfinishedCount, `${hero.providerName}-serie`, `${hero.providerName}-serier`)} först.`,
        action: (
          <Link
            href={`/my/series?provider=${hero.providerId}&status=behind`}
            className={buttonClass({ variant: 'acc', className: 'no-underline' })}
          >
            Visa ({hero.unfinishedCount})
          </Link>
        ),
        why: [`Då kan du pausa ${hero.providerName} (${formatKr(hero.monthlyCost)} kr/mån) utan att missa något.`],
      };
    case 'subscribe':
      return {
        sentence: `Prenumerera på ${hero.providerName}: ${pluralSv(hero.showCount, 'serie du följer', 'serier du följer')} får nya avsnitt snart.`,
        when: hero.nearestAirDate ? `Första avsnittet ${formatSwedishDate(hero.nearestAirDate)}` : undefined,
        action: (
          <Button type="button" variant="acc" onClick={p.onShowSubscribeRows}>Visa titlar</Button>
        ),
        why: ['Nya avsnitt inom 60 dagar på en tjänst du inte har just nu.'],
      };
    case 'idle':
      return {
        sentence: hero.pausedNames.length > 0
          ? `Inget att göra just nu. ${hero.pausedNames.join(', ')} är pausad.`
          : 'Inget att göra just nu. Allt ligger rätt.',
        when: hero.nextCheckDate ? `Titta igen ${formatSwedishDate(hero.nextCheckDate)}` : undefined,
        action: hero.pausedNames.length > 0
          ? <Button type="button" variant="ghost" onClick={() => p.onOpenTab('pausa')}>Se pauser</Button>
          : undefined,
        why: ['Varje tjänst du betalar för har något du följer eller vill se, och inga paket är billigare.'],
      };
  }
}

export default function HeroVerdict(props: Props) {
  const { advisor } = props;
  // Today is stamped once per advisor result so the proposed resume date does not
  // flip while the card is on screen.
  const hero = useMemo(() => heroVerdict(advisor, new Date()), [advisor]);
  if (!hero) return null;
  const answer = answerFor(hero, advisor, props);

  return (
    <section className={cardClass('px-4 py-4 mb-3.5')} aria-labelledby="hero-verdict-q">
      <Eyebrow as="h2" size="xs" id="hero-verdict-q">Den här månaden</Eyebrow>
      <p className="text-xl font-semibold text-ink mt-1.5">{answer.sentence}</p>
      {answer.terms && <p className="text-xs text-ink-2 mt-1">{answer.terms}</p>}
      {answer.when && <p className="text-xs font-semibold text-cal-deep mt-1">{answer.when}</p>}
      {answer.action && <div className="mt-3">{answer.action}</div>}
      <details className="mt-3">
        <summary className={eyebrowClass({ size: 'xxs', className: 'cursor-pointer select-none list-none' })}>
          Varför? ›
        </summary>
        <ul className="mt-2 flex flex-col gap-1 text-xs text-ink-2">
          {answer.why.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      </details>
    </section>
  );
}
