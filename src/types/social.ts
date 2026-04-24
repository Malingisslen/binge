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
  config: SessionConfig;
  status: SessionStatus;
  candidates: SessionCandidate[];
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
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
  inviteToken: string | null;
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
