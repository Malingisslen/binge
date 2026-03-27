export interface SwedishProvider {
  id: number;
  name: string;
  shortName: string;
  color: string;
  type: 'flatrate' | 'rent' | 'buy';
}

export const SWEDISH_PROVIDERS: SwedishProvider[] = [
  { id: 8, name: 'Netflix', shortName: 'Netflix', color: '#E50914', type: 'flatrate' },
  { id: 119, name: 'Amazon Prime Video', shortName: 'Prime', color: '#00A8E1', type: 'flatrate' },
  { id: 337, name: 'Disney+', shortName: 'Disney+', color: '#0063E5', type: 'flatrate' },
  { id: 384, name: 'HBO Max', shortName: 'HBO', color: '#7B2FBE', type: 'flatrate' },
  { id: 76, name: 'Viaplay', shortName: 'Viaplay', color: '#FF6B00', type: 'flatrate' },
  { id: 520, name: 'SVT Play', shortName: 'SVT', color: '#0F79AF', type: 'flatrate' },
  { id: 489, name: 'TV4 Play', shortName: 'TV4', color: '#E2001A', type: 'flatrate' },
  { id: 350, name: 'Apple TV+', shortName: 'Apple', color: '#555555', type: 'flatrate' },
  { id: 531, name: 'Paramount+', shortName: 'P+', color: '#0064FF', type: 'flatrate' },
  { id: 510, name: 'Discovery+', shortName: 'Disc+', color: '#1E3264', type: 'flatrate' },
  { id: 35, name: 'Rakuten TV', shortName: 'Rakuten', color: '#BF0000', type: 'rent' },
  { id: 3, name: 'Google Play Movies', shortName: 'Google', color: '#4285F4', type: 'rent' },
  { id: 2, name: 'Apple TV', shortName: 'Apple', color: '#555555', type: 'rent' },
];

export const PROVIDER_MAP = new Map(SWEDISH_PROVIDERS.map(p => [p.id, p]));

export function getProvider(id: number): SwedishProvider | undefined {
  return PROVIDER_MAP.get(id);
}

export function getProviderColor(id: number): string {
  return PROVIDER_MAP.get(id)?.color ?? '#888';
}
