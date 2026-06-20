import type { TMDBProvider } from '@/types';
import { getProvider, canonicalProviderId } from '@/lib/tmdb/providers';
import { useAuth } from '@/hooks/useAuth';
import { type Offer, isLeavingSoon, formatLeaving } from '@/lib/streaming/offers';

interface ProviderTagProps {
  provider: TMDBProvider;
  size?: 'sm' | 'md';
  offer?: Offer;
  nowMs?: number;
}

export default function ProviderTag({ provider, size = 'sm', offer, nowMs }: ProviderTagProps) {
  const { user } = useAuth();
  const mapped = getProvider(provider.provider_id);
  const isMine = user?.myProviders.includes(canonicalProviderId(provider.provider_id)) ?? false;
  const label = mapped?.shortName ?? provider.provider_name;

  const now = nowMs ?? Date.now();
  const leaving = offer && isLeavingSoon(offer, now);
  const price =
    offer && (offer.type === 'rent' || offer.type === 'buy') && offer.priceAmount != null
      ? `${offer.priceAmount} ${offer.priceCurrency ?? ''}`.trim()
      : null;

  const chip =
    size === 'sm' ? (
      <span
        className={`text-xxs px-1 py-[1px] border rounded-sm inline-block mr-[2px] ${
          isMine ? 'border-accent text-accent' : 'border-border-main text-text-muted'
        }`}
      >
        {label}
      </span>
    ) : (
      <span
        className={`text-xs px-2 py-[2px] border rounded-sm inline-block mr-1 ${
          isMine ? 'border-accent text-accent font-semibold' : 'border-border-main text-text-muted'
        }`}
      >
        {label}
      </span>
    );

  const body = (
    <span className="inline-flex items-center gap-1">
      {chip}
      {price && <span className="text-ink-2 text-[12px]">{price}</span>}
      {leaving && (
        <span className="rounded-sm bg-danger-soft text-danger-ink px-1 text-[11px]">
          {formatLeaving(offer!)}
        </span>
      )}
    </span>
  );

  return offer?.link ? (
    <a href={offer.link} target="_blank" rel="noopener noreferrer">
      {body}
    </a>
  ) : (
    body
  );
}
