import { logoUrl } from '@/lib/tmdb/client';
import { affiliateWrap } from '@/lib/tmdb/providers';
import { trackEvent } from '@/lib/analytics';
import { buttonClass } from '@/components/ui/Button';
import type { StripRow } from './ProviderStrip.helpers';

interface ProviderStripProps {
  rows: StripRow[];
  mediaType: 'movie' | 'tv';
  heading?: string | null;
}

// The Open link is a real <a href> so it works without JS and in the
// pre-rendered HTML; trackEvent only observes the click.
export default function ProviderStrip({ rows, mediaType, heading }: ProviderStripProps) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-4">
      {heading !== null && (
        <div className="providers-row" style={{ marginTop: 0, marginBottom: 6 }}>
          <span className="lab">{heading ?? 'finns på'}</span>
        </div>
      )}
      <ul className="m-0 p-0 list-none border border-rule rounded-sm divide-y divide-rule">
        {rows.map(row => {
          const logo = logoUrl(row.logoPath);
          const mine = row.kind === 'mine';
          return (
            <li
              key={`${row.kind}-${row.providerId}`}
              className={`flex items-center gap-2.5 px-2.5 py-2 ${mine ? 'border-l-4 border-l-acc-deep bg-acc-soft' : ''}`}
            >
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} alt="" width={28} height={28} loading="eager" decoding="async" style={{ width: 28, height: 28, borderRadius: 3, border: '1px solid var(--rule)', background: 'var(--placeholder-fill)' }} />
              ) : null}
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-ink truncate">{row.name}</span>
                <span className={`block text-xs ${mine ? 'text-acc-deep font-semibold' : 'text-ink-3'}`}>
                  {row.label}
                  {row.leaving && <span className="ml-1.5 rounded-sm bg-acc-soft text-acc-deep px-1">{row.leaving}</span>}
                </span>
              </span>
              {row.link && (
                <a
                  href={affiliateWrap(row.rawProviderId, row.link)}
                  target="_blank"
                  rel="noopener noreferrer sponsored"
                  aria-label={`Öppna i ${row.name}`}
                  className={buttonClass({ variant: mine ? 'acc' : 'default', size: 'sm' })}
                  onClick={() => trackEvent('provider_clicked', { providerId: row.providerId, offerType: row.offerType, mediaType })}
                >
                  Öppna
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
