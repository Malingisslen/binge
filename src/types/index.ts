// Barrel-re-exports — befintliga callers importerar från '@/types' och det
// ska fortsätta funka. Nya moduler kan importera från specifik fil direkt
// (`@/types/domain`, `@/types/tmdb`, etc) om de vill vara tydligare.

export * from './domain';
export * from './tmdb';
export * from './social';
export * from './advisor';
export * from './recommendations';
