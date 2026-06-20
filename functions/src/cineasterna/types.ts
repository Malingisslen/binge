export interface CineasternaTitle {
  imdbId: string;
  name: string;
  rentable: boolean;
  rentalAmount: number | null;
  rentalCurrency: string | null;
}

export interface CatalogDoc {
  tmdbIds: number[];
  rental: Record<string, { amount: number; currency: string }>; // keyed by tmdbId
  count: number;
  updatedAt: number;
}
