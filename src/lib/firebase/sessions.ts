import {
  collection,
  doc,
  setDoc,
  updateDoc,
  addDoc,
  serverTimestamp,
  onSnapshot,
  Timestamp,
} from 'firebase/firestore';
import { db } from './config';
import { toDate, generateSecureToken } from './utils';
import type {
  SessionConfig,
  SessionCandidate,
  TogetherSession,
  SessionParticipant,
  SessionSwipe,
  VoteKind,
} from '@/types';

const SESSION_TTL_DAYS = 7;

export async function createSession(params: {
  hostUid: string | null;
  // Sessionens etikett — visas i sessionslistor/popover. För grupp-startade
  // sessioner är detta gruppnamnet.
  hostName: string;
  // Värdens PERSONLIGA visningsnamn för deltagar-chippen (G3). Utan den här
  // (vanlig /tillsammans/ny där hostName redan är personens namn) faller vi
  // tillbaka på hostName — men en grupp-startad session ska visa personen i
  // deltagarlistan, inte gruppnamnet.
  hostDisplayName?: string;
  hostProviders: number[];
  config: SessionConfig;
  // Optional grupp-binding. När satt skrivs picks från sessionen till
  // groups/{groupId}/sessionHistory så gruppen minns vad som valts.
  groupId?: string | null;
}): Promise<string> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_TTL_DAYS);

  const sessionRef = await addDoc(collection(db, 'sessions'), {
    hostUid: params.hostUid,
    hostName: params.hostName,
    groupId: params.groupId ?? null,
    config: params.config,
    status: 'active',
    candidates: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    expiresAt: Timestamp.fromDate(expiresAt),
  });

  // Krypto-säkert deltagar-ID för anonyma värdar. Ett gissningsbart ID skulle
  // (med de öppna participant/swipe-skrivreglerna) låta en angripare skriva
  // röster/veto i värdens namn. (M4)
  const participantId = params.hostUid ?? generateSecureToken();
  await setDoc(doc(db, 'sessions', sessionRef.id, 'participants', participantId), {
    uid: params.hostUid,
    displayName: params.hostDisplayName ?? params.hostName,
    providers: params.hostProviders,
    vetoRemaining: 1,
    isHost: true,
    joinedAt: serverTimestamp(),
    lastActiveAt: serverTimestamp(),
  });

  return sessionRef.id;
}

export async function setSessionCandidates(
  sessionId: string,
  candidates: SessionCandidate[],
): Promise<void> {
  await updateDoc(doc(db, 'sessions', sessionId), {
    candidates,
    updatedAt: serverTimestamp(),
  });
}

export async function joinSession(params: {
  sessionId: string;
  participantId: string;
  uid: string | null;
  displayName: string;
  providers: number[];
}): Promise<void> {
  await setDoc(doc(db, 'sessions', params.sessionId, 'participants', params.participantId), {
    uid: params.uid,
    displayName: params.displayName,
    providers: params.providers,
    vetoRemaining: 1,
    isHost: false,
    joinedAt: serverTimestamp(),
    lastActiveAt: serverTimestamp(),
  }, { merge: true });
}

export async function updateParticipantActivity(sessionId: string, participantId: string): Promise<void> {
  await updateDoc(doc(db, 'sessions', sessionId, 'participants', participantId), {
    lastActiveAt: serverTimestamp(),
  });
}

export async function recordSwipe(params: {
  sessionId: string;
  tmdbId: number;
  participantId: string;
  vote: VoteKind;
}): Promise<void> {
  const ref = doc(db, 'sessions', params.sessionId, 'swipes', String(params.tmdbId));
  // Atomär per-nyckel-skrivning utan föregående läsning. Tidigare
  // read-modify-write (getDoc → spread → setDoc) klobbade samtidiga röster:
  // två deltagare som läste samma snapshot och skrev tillbaka skulle skriva
  // över varandras röst. setDoc(merge) gör en djup-merge av nästlade mapar,
  // så att bara den egna nyckeln i 'votes' sätts; andra deltagares röster
  // lämnas orörda och mapen/dokumentet skapas om det saknas. (M4)
  await setDoc(ref, {
    votes: { [params.participantId]: params.vote },
    updatedAt: serverTimestamp(),
  }, { merge: true });

  if (params.vote === 'veto') {
    await updateDoc(doc(db, 'sessions', params.sessionId, 'participants', params.participantId), {
      vetoRemaining: 0,
      lastActiveAt: serverTimestamp(),
    });
  } else {
    await updateParticipantActivity(params.sessionId, params.participantId);
  }
}

export function sessionDocToObject(id: string, data: Record<string, unknown>): TogetherSession {
  return {
    id,
    hostUid: (data.hostUid as string | null) ?? null,
    hostName: (data.hostName as string) ?? '',
    groupId: (data.groupId as string | null) ?? null,
    config: data.config as SessionConfig,
    status: (data.status as TogetherSession['status']) ?? 'active',
    candidates: (data.candidates as SessionCandidate[]) ?? [],
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
    expiresAt: toDate(data.expiresAt),
  };
}

export function participantDocToObject(id: string, data: Record<string, unknown>): SessionParticipant {
  return {
    id,
    uid: (data.uid as string | null) ?? null,
    displayName: (data.displayName as string) ?? '',
    providers: (data.providers as number[]) ?? [],
    vetoRemaining: (data.vetoRemaining as number) ?? 0,
    isHost: (data.isHost as boolean) ?? false,
    joinedAt: toDate(data.joinedAt),
    lastActiveAt: toDate(data.lastActiveAt),
  };
}

export function swipeDocToObject(id: string, data: Record<string, unknown>): SessionSwipe {
  return {
    tmdbId: Number(id),
    votes: (data.votes as Record<string, VoteKind>) ?? {},
    updatedAt: toDate(data.updatedAt),
  };
}

export function subscribeToSession(
  sessionId: string,
  cb: (session: TogetherSession | null) => void,
): () => void {
  return onSnapshot(doc(db, 'sessions', sessionId), snap => {
    if (!snap.exists()) { cb(null); return; }
    cb(sessionDocToObject(snap.id, snap.data()));
  });
}

export function subscribeToParticipants(
  sessionId: string,
  cb: (participants: SessionParticipant[]) => void,
): () => void {
  return onSnapshot(collection(db, 'sessions', sessionId, 'participants'), snap => {
    cb(snap.docs.map(d => participantDocToObject(d.id, d.data())));
  });
}

export function subscribeToSwipes(
  sessionId: string,
  cb: (swipes: SessionSwipe[]) => void,
): () => void {
  return onSnapshot(collection(db, 'sessions', sessionId, 'swipes'), snap => {
    cb(snap.docs.map(d => swipeDocToObject(d.id, d.data())));
  });
}

export async function setSessionStatus(
  sessionId: string,
  status: TogetherSession['status'],
): Promise<void> {
  await updateDoc(doc(db, 'sessions', sessionId), {
    status,
    updatedAt: serverTimestamp(),
  });
}
