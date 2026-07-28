import type { MediaType } from './domain';

// "Tillsammans ikväll" — session-baserad gemensam rekommendation
export type ProviderMode = 'intersect' | 'union';
export type AggregationStrategy = 'least_misery' | 'average' | 'fair';
export type SessionMediaType = 'movie' | 'tv' | 'both';
export type SessionStatus = 'active' | 'resolved' | 'expired';
export type VoteKind = 'yes' | 'no' | 'veto';

export interface SessionConfig {
  providerMode: ProviderMode;
  aggregation: AggregationStrategy;
  mediaType: SessionMediaType;
  maxRuntimeMin: number | null;
  allowAsymmetry: boolean;
}

export interface SessionCandidate {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  posterPath: string | null;
  year: number | null;
  runtime: number | null;
  genreIds: number[];
  voteAverage: number;
  overview: string;
  providers: number[];
}

export interface TogetherSession {
  id: string;
  hostUid: string | null;
  hostName: string;
  // Om sessionen startades från en grupps "Starta filmkväll"-knapp så binder
  // detta sessionen till gruppen. När en titel sedan väljs skrivs den till
  // groups/{groupId}/sessionHistory så gruppen minns vad som valts.
  // null = ad-hoc-session utan grupp-binding (vanlig Tillsammans-länk).
  groupId: string | null;
  config: SessionConfig;
  status: SessionStatus;
  candidates: SessionCandidate[];
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

// Avtryck av en avslutad Tillsammans-session i den grupp som startade den.
// Skrivs när host trycker "Den här tar vi" på en match. Listas under
// "Senaste filmkvällar" på grupp-sidan.
export interface GroupSessionHistoryEntry {
  sessionId: string;
  pickedTmdbId: number;
  mediaType: 'movie' | 'tv';
  pickedAt: Date;
  participantUids: string[];
  mediaTitle: string;
  posterPath: string | null;
}

export interface SessionParticipant {
  id: string;
  uid: string | null;
  displayName: string;
  providers: number[];
  vetoRemaining: number;
  isHost: boolean;
  joinedAt: Date;
  lastActiveAt: Date;
}

export interface SessionSwipe {
  tmdbId: number;
  // TMDB:s film- och serie-id:n är SKILDA nummerrymder — film 42 och serie 42
  // är orelaterade titlar. Swipe-dokument namnges därför `movie_42`/`tv_42`.
  // null = ett LEGACY-dokument som skrevs på bara numret innan BIN-569; det
  // går inte att tillskriva en medietyp och matchas på nummer allena tills
  // sessionen faller för sin 7-dagars TTL.
  mediaType: MediaType | null;
  votes: Record<string, VoteKind>;
  updatedAt: Date;
}

// Permanenta grupper (Fas 2)
export type GroupRole = 'owner' | 'member';

export interface GroupDefaults {
  providerMode: ProviderMode;
  aggregation: AggregationStrategy;
  mediaType: SessionMediaType;
}

export interface Group {
  id: string;
  name: string;
  ownerUid: string;
  memberUids: string[];
  defaults: GroupDefaults;
  // Endast hash av inbjudningstoken lagras — plaintext finns bara i URL:n
  // som ägaren delar och cachas client-side i localStorage. Firestore-regeln
  // verifierar besittning av token via en sealed joinAttempts-subkollektion.
  inviteTokenHash: string | null;
  inviteTokenRotatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GroupMember {
  uid: string;
  displayName: string;
  username: string | null;
  photoURL: string | null;
  providers: number[];
  role: GroupRole;
  joinedAt: Date;
  notifications: boolean;
}

export interface GroupWatchlistItem {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  releaseYear: number | null;
  addedBy: string;
  addedAt: Date;
  memberRatings: Record<string, number>;
}
