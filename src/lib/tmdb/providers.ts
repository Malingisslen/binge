export interface SwedishProvider {
  id: number;
  name: string;
  shortName: string;
  color: string;
  type: 'flatrate' | 'rent' | 'buy';
  defaultMonthlyCost?: number;
}

export const SWEDISH_PROVIDERS: SwedishProvider[] = [
  { id: 8, name: 'Netflix', shortName: 'Netflix', color: '#E50914', type: 'flatrate', defaultMonthlyCost: 139 },
  { id: 119, name: 'Amazon Prime Video', shortName: 'Prime', color: '#00A8E1', type: 'flatrate', defaultMonthlyCost: 79 },
  { id: 337, name: 'Disney+', shortName: 'Disney+', color: '#0063E5', type: 'flatrate', defaultMonthlyCost: 99 },
  { id: 384, name: 'HBO Max', shortName: 'HBO', color: '#7B2FBE', type: 'flatrate', defaultMonthlyCost: 139 },
  { id: 76, name: 'Viaplay', shortName: 'Viaplay', color: '#FF6B00', type: 'flatrate', defaultMonthlyCost: 149 },
  { id: 520, name: 'SVT Play', shortName: 'SVT', color: '#0F79AF', type: 'flatrate', defaultMonthlyCost: 0 },
  { id: 489, name: 'TV4 Play', shortName: 'TV4', color: '#E2001A', type: 'flatrate', defaultMonthlyCost: 139 },
  { id: 350, name: 'Apple TV+', shortName: 'Apple', color: '#555555', type: 'flatrate', defaultMonthlyCost: 89 },
  { id: 531, name: 'Paramount+', shortName: 'P+', color: '#0064FF', type: 'flatrate', defaultMonthlyCost: 79 },
  { id: 510, name: 'Discovery+', shortName: 'Disc+', color: '#1E3264', type: 'flatrate', defaultMonthlyCost: 89 },
  { id: 1899, name: 'Max', shortName: 'Max', color: '#002BE7', type: 'flatrate', defaultMonthlyCost: 139 },
  { id: 323, name: 'Crunchyroll', shortName: 'CR', color: '#F47521', type: 'flatrate', defaultMonthlyCost: 89 },
  { id: 431, name: 'SkyShowtime', shortName: 'Sky', color: '#0D1D40', type: 'flatrate', defaultMonthlyCost: 89 },
  { id: 335, name: 'YouTube Premium', shortName: 'YT', color: '#FF0000', type: 'flatrate', defaultMonthlyCost: 129 },
  { id: 521, name: 'Tele2 Play', shortName: 'Tele2', color: '#00A0D6', type: 'flatrate', defaultMonthlyCost: 99 },
  { id: 578, name: 'TriArt Play', shortName: 'TriArt', color: '#222222', type: 'flatrate', defaultMonthlyCost: 79 },
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
