import type { TMDBProvider } from '@/types';
import { getProvider, canonicalProviderId } from '@/lib/tmdb/providers';
import { useAuth } from '@/hooks/useAuth';

interface ProviderTagProps {
  provider: TMDBProvider;
  size?: 'sm' | 'md';
}

export default function ProviderTag({ provider, size = 'sm' }: ProviderTagProps) {
  const { user } = useAuth();
  const mapped = getProvider(provider.provider_id);
  const isMine = user?.myProviders.includes(canonicalProviderId(provider.provider_id)) ?? false;
  const label = mapped?.shortName ?? provider.provider_name;

  if (size === 'sm') {
    return (
      <span
        className={`text-xxs px-1 py-[1px] border rounded-sm inline-block mr-[2px] ${
          isMine
            ? 'border-accent text-accent'
            : 'border-border-main text-text-muted'
        }`}
      >
        {label}
      </span>
    );
  }

  return (
    <span
      className={`text-xs px-2 py-[2px] border rounded-sm inline-block mr-1 ${
        isMine
          ? 'border-accent text-accent font-semibold'
          : 'border-border-main text-text-muted'
      }`}
    >
      {label}
    </span>
  );
}
