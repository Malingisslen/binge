import { canonicalUniqueProviders, getProvider } from '@/lib/tmdb/providers';

/**
 * Visuella provider-indikatorer för watchlist-vyer.
 *
 * ProviderChips — bordered pills under serietitel i tabell/kortvy.
 * PosterProviderDots — tre små färgade prickar i övre hörnet på poster-grid.
 *
 * Båda visar max 3 providers och markerar "mina" (användarens prenumerationer)
 * med antingen accent-färgad border eller full opacitet.
 */

const MAX_PROVIDERS_SHOWN = 3;

// Sparad data kan bära både en tjänsts id och ett av dess alias (HBO Max 384 och 1899),
// som annars blir två likadana märken. Ett märke per tjänst, i den sparade ordningen.
function distinctProviders(providers: number[], myProviders: number[]): { id: number; isMine: boolean }[] {
  const mine = new Set(canonicalUniqueProviders(myProviders));
  return canonicalUniqueProviders(providers)
    .filter(id => getProvider(id))
    .slice(0, MAX_PROVIDERS_SHOWN)
    .map(id => ({ id, isMine: mine.has(id) }));
}

export function ProviderChips({
  providers,
  myProviders,
  providersCheckedAt,
  className = '',
}: {
  providers: number[];
  myProviders: number[];
  // När satt + providers tom = vi har frågat TMDB och titeln streamas inte
  // i SE just nu. Visa dämpad indikator istället för tomt.
  providersCheckedAt?: Date | null;
  className?: string;
}) {
  // "Ej på SE" bara när TMDB inte gav någon tjänst alls. Tjänster utanför vår
  // tabell (t.ex. Amazon Video 10, hyr/köp) betyder att titeln FINNS här.
  if (providers.length === 0) {
    if (providersCheckedAt == null) return null;
    return (
      <div className={`flex flex-wrap gap-[2px] ${className}`}>
        <span className="text-xxs px-1 py-[1px] border border-rule-2 text-ink-3/70 rounded-sm inline-block">
          Ej på SE
        </span>
      </div>
    );
  }
  const items = distinctProviders(providers, myProviders);
  if (items.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-[2px] ${className}`}>
      {items.map(({ id, isMine }) => {
        const p = getProvider(id)!;
        return (
          <span
            key={id}
            className={`text-xxs px-1 py-[1px] border rounded-sm inline-block ${
              isMine ? 'border-acc-deep text-acc-deep' : 'border-rule text-ink-3'
            }`}
          >
            {p.shortName}
          </span>
        );
      })}
    </div>
  );
}

export function PosterProviderDots({ providers, myProviders }: { providers: number[]; myProviders: number[] }) {
  const items = distinctProviders(providers, myProviders);
  if (items.length === 0) return null;
  return (
    <div className="absolute top-1 right-1 flex flex-col gap-[3px]">
      {items.map(({ id, isMine }) => {
        const p = getProvider(id)!;
        return (
          <span
            key={id}
            title={p.name}
            className={`block w-[7px] h-[7px] rounded-full ${isMine ? '' : 'opacity-50'}`}
            style={{ backgroundColor: p.color, outline: '1.5px solid rgba(0,0,0,0.35)' }}
          />
        );
      })}
    </div>
  );
}
