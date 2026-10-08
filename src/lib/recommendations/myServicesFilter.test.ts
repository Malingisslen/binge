import { describe, it, expect } from 'vitest';
import { keepOnMyServices } from './myServicesFilter';
import type { TMDBProviderData } from '@/types/tmdb';

const NETFLIX = 8;
const MAX = 1899;
const offer = (provider_id: number) => ({ provider_id, provider_name: '', logo_path: '', display_priority: 0 });
const title = (id: number) => ({ id, media_type: 'movie' });

describe('keepOnMyServices', () => {
  const providers: Record<string, TMDBProviderData> = {
    'movie-1': { link: '', flatrate: [offer(NETFLIX)] },
    'movie-2': { link: '', flatrate: [offer(MAX)] },
    'movie-3': { link: '', rent: [offer(NETFLIX)] },
    'movie-4': { link: '', ads: [offer(NETFLIX)] },
  };

  it('behåller bara titlar som går att se på en egen tjänst', () => {
    const kept = keepOnMyServices([title(1), title(2), title(3), title(4)], providers, [NETFLIX]);
    expect(kept.map(t => t.id)).toEqual([1, 4]);
  });

  it('räknar inte hyra eller köp', () => {
    expect(keepOnMyServices([title(3)], providers, [NETFLIX])).toEqual([]);
  });

  it('lämnar bort en titel vars tjänster inte hämtats än', () => {
    expect(keepOnMyServices([title(9)], providers, [NETFLIX])).toEqual([]);
  });

  it('skiljer film och serie med samma id', () => {
    expect(keepOnMyServices([{ id: 1, media_type: 'tv' }], providers, [NETFLIX])).toEqual([]);
  });
});
