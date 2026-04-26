import { getProvider } from '@/lib/tmdb/providers';

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

export function ProviderChips({
  providers,
  myProviders,
  providersCheckedAt,
}: {
  providers: number[];
  myProviders: number[];
  // När satt + providers tom = vi har frågat TMDB och titeln streamas inte
  // i SE just nu. Visa dämpad indikator istället för tomt.
  providersCheckedAt?: Date | null;
}) {
  const items = providers.slice(0, MAX_PROVIDERS_SHOWN);
  if (items.length === 0) {
    if (providersCheckedAt == null) return null;
    return (
      <div className="flex flex-wrap gap-[2px]">
        <span className="text-xxs px-1 py-[1px] border border-border-light text-text-muted/70 rounded-sm inline-block">
          Ej på SE
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-[2px]">
      {items.map(id => {
        const p = getProvider(id);
        if (!p) return null;
        const isMine = myProviders.includes(id);
        return (
          <span
            key={id}
            className={`text-xxs px-1 py-[1px] border rounded-sm inline-block ${
              isMine ? 'border-accent text-accent' : 'border-border-main text-text-muted'
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
  const items = providers.slice(0, MAX_PROVIDERS_SHOWN);
  if (items.length === 0) return null;
  return (
    <div className="absolute top-1 right-1 flex flex-col gap-[3px]">
      {items.map(id => {
        const p = getProvider(id);
        if (!p) return null;
        const isMine = myProviders.includes(id);
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
