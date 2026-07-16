'use client';

import { useQuery } from '@tanstack/react-query';
import type { QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';
import { fsdb } from '@/lib/firebase/db';
import { toDate } from '@/lib/firebase/utils';
import { getPublicProfileCard, type PublicProfileCard } from '@/lib/firebase/publicProfile';
import { migrateStatus } from '@/lib/watchStatus.migration';
import type { WatchlistItem, MediaType } from '@/types';

// Tre möjliga resultat:
// - null                                      → username-doc finns inte (verkligen ej användare)
// - { uid, username, isPrivate: true }        → finns men projektion ej läsbar (privat/ej-vän)
// - { uid, card }                             → publik/vän-läsbar profil (display-fält)
//
// usernames-collection är public-read så vi kan alltid skilja "okänd
// användare" från "privat profil" — bättre UX-feedback.
export type PublicProfileResult =
  | null
  | { uid: string; username: string; isPrivate: true }
  | { uid: string; card: PublicProfileCard };

export function usePublicProfile(username: string) {
  return useQuery<PublicProfileResult>({
    queryKey: ['public-profile', username],
    queryFn: async () => {
      const { db, doc, getDoc } = await fsdb();
      const usernameSnap = await getDoc(doc(db, 'usernames', username));
      if (!usernameSnap.exists()) return null;
      const uid = usernameSnap.data().uid as string;
      // BIN-505: users/{uid} är ägar-låst — publik/vän-läsare når BARA
      // publicProfiles/{uid}-projektionen. Går den att läsa → profilen är
      // synlig för mig (rules gate:ar publik ELLER vän live mot källan). null →
      // privat/ej-vän (eller ännu ej backfillad projektion) → visa "privat".
      const card = await getPublicProfileCard(uid);
      if (!card) return { uid, username, isPrivate: true };
      return { uid, card };
    },
    staleTime: 60_000,
  });
}

// Power-user med 2000+ titlar skulle annars kosta 2000 Firestore-reads per
// profilvisning. 500 är taket för vad vi renderar på en offentlig profil —
// behöver användaren se mer får det bli via filterar/sök senare.
const PUBLIC_WATCHLIST_LIMIT = 500;

function mapWatchlistDoc(d: QueryDocumentSnapshot<DocumentData>): WatchlistItem {
  const data = d.data();
  const mediaType = data.mediaType as MediaType;
  // Använd shared migration så publik profil ser samma statusar som
  // ägaren — annars skulle vänner se 'följer' badge medan ägaren ser
  // 'mina' i sin egen vy.
  const { status, dropped } = migrateStatus(
    data.status as string,
    mediaType,
    data.dropped as boolean | undefined,
  );
  return {
    tmdbId: data.tmdbId as number,
    mediaType,
    status,
    rating: (data.rating as number) ?? null,
    notes: null,
    title: data.title as string,
    posterPath: (data.posterPath as string) ?? null,
    releaseYear: (data.releaseYear as number) ?? null,
    totalSeasons: (data.totalSeasons as number) ?? null,
    lastWatchedSeason: (data.lastWatchedSeason as number) ?? null,
    lastWatchedEpisode: (data.lastWatchedEpisode as number) ?? null,
    dropped,
    rewatchCount: (data.rewatchCount as number) ?? 0,
    providers: (data.providers as number[]) ?? [],
    genreIds: (data.genreIds as number[]) ?? [],
    addedAt: toDate(data.addedAt),
    updatedAt: toDate(data.updatedAt),
    watchedAt: data.watchedAt ? toDate(data.watchedAt) : null,
  } as WatchlistItem;
}

export function usePublicWatchlist(uid: string | null) {
  return useQuery({
    queryKey: ['public-watchlist', uid],
    queryFn: async () => {
      const { db, collection, query, where, limit, getDocs } = await fsdb();
      const col = collection(db, 'users', uid!, 'watchlist');
      const byId = new Map<string, WatchlistItem>();

      // firestore.rules tillåter en list-query bara om VARJE matchad doc är
      // läsbar enligt en enda regel — rules filtrerar inte, de avvisar hela
      // queryn så fort en doc faller utanför. Därför kan vi inte köra en
      // ofiltrerad query (den dör om profilen har minst en privat titel).
      // Vi gör istället en query per visibility-tier och slår ihop resultaten.

      // 1. Publika items — alltid läsbara, så denna query går alltid igenom.
      try {
        const snap = await getDocs(
          query(col, where('effectiveVisibility', '==', 'public'), limit(PUBLIC_WATCHLIST_LIMIT)),
        );
        snap.docs.forEach(d => byId.set(d.id, mapWatchlistDoc(d)));
      } catch {
        // Permission-denied (t.ex. helt privat profil) — svälj, fortsätt.
      }

      // 2. Vän-synliga items — bara läsbara om jag är vän med ägaren, annars
      //    avvisar rules queryn. Svälj felet på privata/icke-vän-profiler.
      try {
        const snap = await getDocs(
          query(col, where('effectiveVisibility', '==', 'friends'), limit(PUBLIC_WATCHLIST_LIMIT)),
        );
        snap.docs.forEach(d => byId.set(d.id, mapWatchlistDoc(d)));
      } catch {
        // Inte vän (eller privat) — inga vän-synliga items att visa.
      }

      // 3. Legacy-items utan effectiveVisibility-fältet (innan cascade-stämpling).
      //    Firestore kan inte fråga på "fält saknas", så vi försöker en
      //    ofiltrerad query — den går bara igenom om HELA watchlistan är
      //    legacy-publik. Misslyckas den (blandade/privata items) sväljs den
      //    och vi nöjer oss med de filtrerade tiers ovan.
      //
      //    Visibility-mekanism (A4.3): synligheten avgörs SERVER-SIDIGT via
      //    query på `effectiveVisibility` + Firestore-rules (rules avvisar,
      //    de filtrerar inte). En doc som saknar BÅDE `effectiveVisibility`
      //    och `isPublic` faller därför default tillbaka till "inte publik" —
      //    den matchar varken query 1 eller 2, och dyker bara upp via denna
      //    fallback om hela listan är läsbar. "Frånvarande = inte publik" är
      //    alltså den inbyggda säkra defaulten; ingen klient-sidig owner-flagg-
      //    fallback behövs. Nya skrivningar re-asserterar fälten lazy-on-write
      //    (se WatchlistContext) så gamla orörda docs migreras vid första
      //    ändring.
      try {
        const snap = await getDocs(query(col, limit(PUBLIC_WATCHLIST_LIMIT)));
        snap.docs.forEach(d => byId.set(d.id, mapWatchlistDoc(d)));
      } catch {
        // Förväntat på profiler med minst en privat/mixad titel — ignorera.
      }

      return Array.from(byId.values()).slice(0, PUBLIC_WATCHLIST_LIMIT);
    },
    enabled: uid !== null,
    staleTime: 60_000,
  });
}
