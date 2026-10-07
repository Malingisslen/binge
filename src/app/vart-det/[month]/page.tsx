import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/layout/PageHeader';
import VartDetLeavingCount from '@/components/pages/VartDetLeavingCount';
import JustWatchCredit from '@/components/ui/JustWatchCredit';
import { buttonClass } from '@/components/ui/Button';
import { badgeClass } from '@/components/ui/Badge';
import { cardClass } from '@/components/ui/Card';
import { thClass } from '@/components/ui/tableHead';
import { formatKr } from '@/lib/formatKr';
import { cheapestEntertainmentTier, getProvider, PRICE_CHANGES } from '@/lib/tmdb/providers';
import { SEO_PROVIDER_IDS } from '@/lib/tmdb/seoCoverage';
import {
  LEVEL_RULE_TEXT, NEW_LEVEL_TEXT, VART_DET_MONTHS, VART_DET_ROBOTS, dayText, introText, newLevel, oldestCheck,
  parseVartDetMonth, premiereText, priceChangeText,
} from '@/lib/seo/vartDet';
import { fetchMonthPremieres } from '@/lib/seo/vartDetPremieres';

export const dynamic = 'force-static';
export const dynamicParams = false;

const SITE = 'https://binge.nu';

type PageParams = { month: string };

export function generateStaticParams(): PageParams[] {
  return VART_DET_MONTHS.map(month => ({ month }));
}

export async function generateMetadata({ params }: { params: Promise<PageParams> }): Promise<Metadata> {
  const month = parseVartDetMonth((await params).month);
  const url = `${SITE}/vart-det/${month?.id ?? ''}/`;
  if (!month) return { robots: VART_DET_ROBOTS, alternates: { canonical: url } };
  const title = `Värt det i ${month.name} ${month.year}`;
  const description = introText(month, null);
  return {
    title,
    description,
    robots: VART_DET_ROBOTS,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: 'Binge.nu', locale: 'sv_SE', type: 'website' },
  };
}

function paidServices() {
  return SEO_PROVIDER_IDS.flatMap(id => {
    const p = getProvider(id);
    if (!p || p.isFree) return [];
    const cheapest = cheapestEntertainmentTier(id);
    return Number.isFinite(cheapest.cost) ? [{ provider: p, ...cheapest }] : [];
  });
}

export default async function VartDetPage({ params }: { params: Promise<PageParams> }) {
  const month = parseVartDetMonth((await params).month);
  if (!month) notFound();
  const services = paidServices();
  const premieres = await fetchMonthPremieres(services.map(s => s.provider.id), month);
  const checked = oldestCheck(services.map(s => s.provider.priceVerifiedDate));
  // TMDB only lists a title on a service once it is there, so the column is as of the build.
  const builtOn = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });

  return (
    <div>
      <PageHeader
        crumb={`binge.nu/vart-det/${month.id}`}
        title={`Värt det i ${month.name} ${month.year}`}
        standfirst={introText(month, checked)}
      />
      <div className={cardClass('mt-6 overflow-x-auto')}>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th scope="col" className={thClass('text-left px-3')}>Tjänst</th>
              <th scope="col" className={thClass('text-right px-3')}>Från</th>
              <th scope="col" className={thClass('text-left px-3')}>Nytt i {month.name}</th>
              <th scope="col" className={thClass('text-left px-3')}>Pris</th>
              <th scope="col" className={thClass('text-right px-3')}>Försvinner</th>
              <th scope="col" className={thClass('text-left px-3')}>Binges räkning</th>
            </tr>
          </thead>
          <tbody>
            {services.map(({ provider, cost, tier }) => {
              const list = premieres.get(provider.id) ?? null;
              const shown = list ? premiereText(list) : null;
              const level = list ? newLevel(list.length) : null;
              const priceText = priceChangeText(provider.id, tier?.id ?? null, month, PRICE_CHANGES);
              return (
                <tr key={provider.id} className="border-t border-rule-2 align-top">
                  <td className="px-3 py-1.5 font-bold text-ink">{provider.shortName}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-ink">{formatKr(cost)} kr</td>
                  <td className="px-3 py-1.5 text-ink">
                    {list == null ? <span className="text-ink-3">–</span>
                      : shown ? <>{shown.first}{shown.more && <span className="block text-xs text-ink-2">{shown.more}</span>}</>
                        : <span className="text-ink-2">Inget nytt enligt TMDB</span>}
                  </td>
                  <td className={`px-3 py-1.5 ${priceText === 'Oförändrat' ? 'text-ink-2' : 'text-ink font-semibold'}`}>{priceText}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-ink">
                    <VartDetLeavingCount providerId={provider.id} monthId={month.id} />
                  </td>
                  <td className="px-3 py-1.5">
                    {level && <span className={badgeClass(level === 'mycket' ? 'acc' : 'muted')}>{NEW_LEVEL_TEXT[level]}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-ink-2">{LEVEL_RULE_TEXT}</p>
      <p className="mt-1 text-xs text-ink-3">
        Nytt i {month.name} är det TMDB visade den {dayText(builtOn)}. Försvinner räknas när sidan öppnas.
      </p>
      <JustWatchCredit className="mt-1" />
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/streamingkostnad/" className={buttonClass({ variant: 'acc' })}>Räkna på din egen streaming</Link>
        <Link href="/streamingpriser/" className={buttonClass()}>Alla priser</Link>
      </div>
    </div>
  );
}
