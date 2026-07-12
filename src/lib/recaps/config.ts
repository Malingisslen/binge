// BIN-185 — client feature gate. The /recap batch (P3) hasn't seeded any recaps yet, so
// until it has, every eligible TV-show page view would fire a guaranteed-MISS getDoc against
// the recaps collection — an avoidable draw on the 25 SEK/mån Blaze cap for a dormant feature.
// The client read is gated on this flag; flip to true once recaps exist in prod (after the
// first /recap batch run).
// ENABLED 2026-07-12: Grey's Anatomy S1 (tmdbId 1416) seeded — 9 spoiler-safe recaps live.
export const RECAPS_ENABLED = true;
