'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  subscribeToMyGroups,
  subscribeToGroup,
  subscribeToGroupMembers,
  subscribeToGroupWatchlist,
  subscribeToMyGroupInvites,
  getPublicGroupName,
  acceptGroupInvite as acceptInvite,
  declineGroupInvite as declineInvite,
  type GroupInvite,
} from '@/lib/firebase/groups';
import { useAuth } from '@/hooks/useAuth';
import type { AcceptInviteResult } from '@/lib/firebase/groups';
import type { Group, GroupMember, GroupWatchlistItem } from '@/types';

export function useMyGroups(uid: string | null) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) { setGroups([]); setLoading(false); return; }
    setLoading(true);
    const unsub = subscribeToMyGroups(uid, gs => {
      setGroups(gs.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()));
      setLoading(false);
    });
    return () => unsub();
  }, [uid]);

  return { groups, loading };
}

/**
 * BIN-1152: `denied` och `publicName` är det som håller sidan ändlig.
 *
 * Gruppdokumentet är läsbart bara för medlemmar, så för en icke-medlem svarar
 * prenumerationen med permission-denied i stället för med ett dokument. Utan ett
 * eget tillstånd för det hade `loading` stått kvar sant för alltid.
 *
 * `publicName` hämtas BARA när läsningen nekades, och den svarar på frågan
 * nekandet inte kan: finns gruppen? Ett namn betyder "den finns, du är inte med".
 * Null betyder att vi inte vet — antingen finns den inte, eller så saknar den
 * projektion (en grupp skapad före biljetten). Ytan väljer skärm på det.
 */
export function useGroup(groupId: string | null) {
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [watchlist, setWatchlist] = useState<GroupWatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [denied, setDenied] = useState(false);
  const [publicName, setPublicName] = useState<string | null>(null);
  /**
   * BIN-1152: en `onSnapshot` som fått permission-denied är DÖD. Den startar inte
   * om av sig själv när reglerna senare släpper igenom samma läsare, och det är
   * precis vad ett lyckat join gör — skrivningen ändrar regelutfallet, inget
   * snapshot-event gör det.
   *
   * Utan den här bumpen får den som just använt en fullt giltig inbjudningslänk
   * skärmen "du är inte medlem i den här gruppen" tills hen laddar om sidan.
   * Mönstret och skälet finns redan i `useGroupHousehold`, som gör samma sak runt
   * opt-in/opt-out mot share-to-see-reglerna.
   */
  const [epoch, setEpoch] = useState(0);
  const resubscribe = useCallback(() => setEpoch(e => e + 1), []);

  useEffect(() => {
    if (!groupId) { setLoading(false); return; }
    let alive = true;
    setLoading(true);
    setNotFound(false);
    setDenied(false);
    setPublicName(null);

    const unsubs = [
      subscribeToGroup(
        groupId,
        g => {
          if (!alive) return;
          setGroup(g);
          setNotFound(g == null);
          setDenied(false);
          setLoading(false);
        },
        () => {
          if (!alive) return;
          // Nekad: vi är inte medlem. Gruppen kan ändå finnas, och namnet får nå
          // oss — hämta det ur projektionen så ytan kan skilja
          // "finns inte" från "finns men du är inte medlem".
          setGroup(null);
          setDenied(true);
          setNotFound(false);
          // `loading` släpps FÖRST när projektionen svarat, inte här. Nekandet och
          // namnuppslaget är två rundturer, och att släppa emellan hade blinkat
          // "gruppen hittades inte" innan "du är inte medlem i X" — ytan väljer
          // skärm på `publicName`, så den måste ha satt sig.
          getPublicGroupName(groupId)
            .then(name => { if (alive) { setPublicName(name); setLoading(false); } })
            .catch(() => {
              // Utan namn visas "hittades inte" — samma skärm som före biljetten.
              if (alive) setLoading(false);
            });
        },
        () => {
          if (!alive) return;
          // Transient: INTE en icke-medlemsskärm. Att dirigera hit hade sagt "du
          // är inte medlem" till en medlem med dålig uppkoppling.
          setNotFound(true);
          setLoading(false);
        },
      ),
      subscribeToGroupMembers(groupId, setMembers),
      subscribeToGroupWatchlist(groupId, setWatchlist),
    ];

    return () => { alive = false; unsubs.forEach(fn => fn()); };
  }, [groupId, epoch]);

  return { group, members, watchlist, loading, notFound, denied, publicName, resubscribe };
}

// Inkomna grupp-inbjudningar + accept/decline-actions. accept använder inloggad
// användares profil (displayName/username/photoURL/myProviders) för member-doc:et.
export function useMyGroupInvites() {
  const { uid, user } = useAuth();
  const [invites, setInvites] = useState<GroupInvite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) { setInvites([]); setLoading(false); return; }
    setLoading(true);
    const unsub = subscribeToMyGroupInvites(uid, inv => {
      setInvites(inv);
      setLoading(false);
    });
    return () => unsub();
  }, [uid]);

  // BIN-1166: utfallet RETURNERAS. Forr awaitades det och kastades bort, sa varken
  // ett nekande eller ett natverksfel nadde ytan — inbjudan lag kvar i listan utan
  // forklaring. Formen ar densamma som joinGroupViaToken redan har.
  //
  // BIN-1155: platshallaren 'Användare' ar borta. Medlemsdokumentets regel binder
  // numera namnet till skrivarens egen profil, sa ett platshallarnamn hade NEKATS —
  // samma fela som BIN-1127 stangde for gruppinbjudningar. Funktionen ar redan gatad
  // pa att profilen ar laddad (`!user` returnerar ovan), sa vardet finns.
  const accept = useCallback(async (groupId: string): Promise<AcceptInviteResult> => {
    if (!uid || !user) return { ok: false, reason: 'transient' };
    return acceptInvite({
      groupId,
      uid,
      displayName: user.displayName,
      username: user.username,
      photoURL: user.photoURL,
      providers: user.myProviders ?? [],
    });
  }, [uid, user]);

  const decline = useCallback(async (groupId: string) => {
    if (!uid) return;
    await declineInvite(uid, groupId);
  }, [uid]);

  return { invites, loading, accept, decline };
}
