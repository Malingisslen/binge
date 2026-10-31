'use client';

import { useCallback, useEffect, useState } from 'react';
import { fsdb, lazySubscribe } from '@/lib/firebase/db';
import { toDate } from '@/lib/firebase/utils';
import { useAuth } from '@/hooks/useAuth';

export interface TvDevice {
  id: string;
  name: string;
  createdAt: Date | null;
  lastSeenAt: Date | null;
}

function optionalDate(v: unknown): Date | null {
  return v == null ? null : toDate(v);
}

/**
 * `users/{uid}/tvDevices`: the TVs paired to this account. Only the server creates a row;
 * the owner reads and deletes (firestore.rules). Deleting a row disconnects that TV at once.
 * `devices` is null until the first snapshot, and again if the listener fails, so a read error
 * never shows as "Ingen TV kopplad".
 */
export function useTvDevices() {
  const { uid } = useAuth();
  const [devices, setDevices] = useState<TvDevice[] | null>(null);

  useEffect(() => {
    if (!uid) {
      setDevices(null);
      return;
    }
    return lazySubscribe(({ db, collection, onSnapshot }) =>
      onSnapshot(
        collection(db, 'users', uid, 'tvDevices'),
        snap => {
          const rows = snap.docs.map(d => {
            const data = d.data() as { name?: unknown; createdAt?: unknown; lastSeenAt?: unknown };
            return {
              id: d.id,
              name: typeof data.name === 'string' && data.name ? data.name : 'Google TV',
              createdAt: optionalDate(data.createdAt),
              lastSeenAt: optionalDate(data.lastSeenAt),
            };
          });
          rows.sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
          setDevices(rows);
        },
        () => setDevices(null),
      ));
  }, [uid]);

  const disconnect = useCallback(async (deviceId: string) => {
    if (!uid) return;
    const { db, doc, deleteDoc } = await fsdb();
    await deleteDoc(doc(db, 'users', uid, 'tvDevices', deviceId));
  }, [uid]);

  const disconnectAll = useCallback(async (deviceIds: readonly string[]) => {
    if (!uid || deviceIds.length === 0) return;
    const { db, doc, writeBatch } = await fsdb();
    const batch = writeBatch(db);
    for (const id of deviceIds) batch.delete(doc(db, 'users', uid, 'tvDevices', id));
    await batch.commit();
  }, [uid]);

  return { devices, disconnect, disconnectAll };
}
