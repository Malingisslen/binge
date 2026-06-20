export interface Ratings {
  imdb: { score: number; votes: number } | null;
  rottenTomatoes: number | null; // percent, 0-100
  metacritic: number | null;     // 0-100
}

export interface RatingsDoc extends Ratings {
  imdbId: string;
  checkedAt: number; // epoch millis
}
