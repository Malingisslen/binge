import type { TMDBProvider } from '@/types';
import { getProvider, canonicalProviderId, affiliateWrap } from '@/lib/tmdb/providers';
import { useAuth } from '@/hooks/useAuth';
import { type Offer, isLeavingSoon, formatLeaving } from '@/lib/streaming/offers';

interface ProviderTagProps {
  provider: TMDBProvider;
  size?: 'sm' | 'md';
  offer?: Offer;
  // BIN-145: obligatorisk — en default på epoch-0 (1970) dolde tyst "lämnar
  // snart"-badgen om en anropare glömde proppen. Krävs nu, ingen tyst fallback.
  nowMs: number;
}

export default function ProviderTag({ provider, size = 'sm', offer, nowMs }: ProviderTagProps) {
  const { user } = useAuth();
  const mapped = getProvider(provider.provider_id);
  const isMine = user?.myProviders.includes(canonicalProviderId(provider.provider_id)) ?? false;
  const label = mapped?.shortName ?? provider.provider_name;

  const leaving = offer && isLeavingSoon(offer, nowMs);
  const price =
    offer && (offer.type === 'rent' || offer.type === 'buy') && offer.priceAmount != null
      ? `${offer.priceAmount} ${offer.priceCurrency ?? ''}`.trim()
      : null;

  const chip =
    size === 'sm' ? (
      <span
        className={`text-xxs px-1 py-[1px] border rounded-sm inline-block mr-[2px] ${
          isMine ? 'border-acc-deep text-acc-deep' : 'border-rule text-ink-3'
        }`}
      >
        {label}
      </span>
    ) : (
      <span
        className={`text-xs px-2 py-[2px] border rounded-sm inline-block mr-1 ${
          isMine ? 'border-acc-deep text-acc-deep font-semibold' : 'border-rule text-ink-3'
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
        <span className="rounded-sm bg-acc-soft text-acc-deep px-1 text-[11px]">
          {formatLeaving(offer!)}
        </span>
      )}
    </span>
  );

  return offer?.link ? (
    // BIN-173: route the outbound deeplink through affiliateWrap — a no-op
    // passthrough until an AFFILIATE_PROGRAMS entry exists for this provider.
    <a href={affiliateWrap(provider.provider_id, offer.link)} target="_blank" rel="noopener noreferrer">
      {body}
    </a>
  ) : (
    body
  );
}
