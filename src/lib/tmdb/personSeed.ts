// BIN-423 WP3 — trimma en persons `combined_credits` (bifogad via
// append_to_response i getPerson) till ENBART de fält som filmografin på
// person-sidan faktiskt konsumerar innan den bakas in som build-initialData i
// ~1000 förrenderade /person/[id]-HTML-sidor.
//
// Varför: ett rått combined_credits-svar för en produktiv skådespelare är
// hundratals credits × feta fält (overview, backdrop_path, popularity,
// vote_count, credit_id, episode_count …). Inbäddat i statisk HTML blåser det
// upp varje sida. Vi behåller nyckeluppsättningen men nollar de tunga
// textfälten → ~20–60 KB istället för hundratals KB.
//
// Konsumtionen (håll i synk om person-sidan ändras):
//   - PersonPageClient-derivationen: id, media_type, character (cast),
//     job (crew), vote_average (sortering)
//   - TitleCard: getDisplayTitle (title/name/original_title/original_name),
//     poster_path, genre_ids (duotone), getReleaseYear (release_date/
//     first_air_date), vote_average.toFixed(1) — MÅSTE vara ett tal.

import type { TMDBPerson, TMDBSearchResult } from '@/types';

// OBS: ingen rad-cap. En tidigare version cappade cast till topp-N på
// vote_average för att bunda export-storleken, men eftersom person-sidan
// återanvänder seeden OCH hoppar över den fulla /combined_credits-hämtningen
// blev truncationen ANVÄNDAR-synlig — och vote_average-sortering släpper
// nyaste (ännu oröstade) titlar sist, dvs precis det en besökare söker. Vi
// trimmar därför bara FÄLT per credit (nedan), aldrig rader. Storleks-taket
// (~20–60 KB för produktiva skådespelare) är den medvetna avvägningen från
// biljetten.

// Behåll formen som TMDBSearchResult (obligatoriska fält måste finnas), men
// släng innehållet i de tunga fälten. vote_average/genre_ids defaultas så en
// credit utan dem inte kraschar TitleCard (`.toFixed`) eller duotone-valet.
function pruneCredit(c: TMDBSearchResult): TMDBSearchResult {
  return {
    id: c.id,
    media_type: c.media_type,
    title: c.title,
    name: c.name,
    original_title: c.original_title,
    original_name: c.original_name,
    poster_path: c.poster_path,
    backdrop_path: null,
    overview: '',
    vote_average: c.vote_average ?? 0,
    genre_ids: c.genre_ids ?? [],
    release_date: c.release_date,
    first_air_date: c.first_air_date,
  };
}

/**
 * Trimma en persons combined_credits inför build-seed. En person UTAN
 * combined_credits (gammal cache-form, eller om append_to_response uteblev)
 * passerar oförändrad — det är SEO-vinsten som uteblir, aldrig ett fel.
 */
export function prunePersonSeed(person: TMDBPerson): TMDBPerson {
  const cc = person.combined_credits;
  if (!cc) return person;
  return {
    ...person,
    combined_credits: {
      cast: (cc.cast ?? []).map(c => ({ ...pruneCredit(c), character: c.character })),
      crew: (cc.crew ?? []).map(c => ({ ...pruneCredit(c), job: c.job })),
    },
  };
}
