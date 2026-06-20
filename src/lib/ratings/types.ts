export interface Ratings {
  imdb: { score: number; votes: number } | null;
  rottenTomatoes: number | null;
  metacritic: number | null;
}

export interface RatingsDoc extends Ratings {
  imdbId: string;
  checkedAt: number;
}
