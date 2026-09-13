import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, screen } from '@testing-library/react';

/**
 * BIN-1152, granskningsfynd: sidan måste STARTA OM grupp-prenumerationen när ett
 * join lyckas.
 *
 * `useGroup` äger mekanismen och har sina egna test (`useGroup.denied.test.tsx`
 * pinnar att `resubscribe` öppnar en ny prenumeration och river den gamla). Det här
 * är den ANDRA halvan, och den behövs för sig: en `resubscribe` ingen anropar är en
 * permanent no-op, och hela sviten står grön medan den som nyss använt en giltig
 * inbjudningslänk ser "du är inte medlem i den här gruppen" tills sidan laddas om.
 * Samma form som BIN-776/852 — "spärren finns" och "spärren körs" är olika
 * påståenden.
 *
 * `useGroup` mockas med flit: ämnet här är anropet, inte hooken.
 */

// Modulgrafen når Firebase-konfigurationen, vars getAuth() på toppnivå kastar på
// testmiljöns dummynyckel. Ingenting på den prövade vägen rör den.
vi.mock('@/lib/firebase/config', () => ({ auth: {}, default: {} }));

const hoisted = vi.hoisted(() => ({
  useGroup: vi.fn(),
  resubscribe: vi.fn(),
  joinGroupViaToken: vi.fn(),
  usePageMeta: vi.fn(),
}));

vi.mock('@/hooks/useGroups', () => ({
  useGroup: hoisted.useGroup,
  useMyGroups: () => ({ groups: [], loading: false }),
  useMyGroupInvites: () => ({ invites: [], loading: false, accept: vi.fn(), decline: vi.fn() }),
}));
vi.mock('@/lib/firebase/groups', () => ({
  joinGroupViaToken: hoisted.joinGroupViaToken,
  deleteGroup: vi.fn(),
  GROUP_WRITE_REFUSED: 'binge/group-write-refused',
  MY_GROUPS_LIMIT: 100,
}));
// BIN-1181: ett test här driver ända fram till gruppvyn. Dess paneler och
// sessionsvägen är inte ämnet, så de ersätts; medlemspanelen lämnar en markör som
// bara gruppvyn renderar.
vi.mock('@/lib/firebase/sessions', () => ({ createSession: vi.fn(), setSessionCandidates: vi.fn() }));
vi.mock('@/lib/together/candidates', () => ({
  computeSessionProviders: () => [],
  generateCandidates: vi.fn(),
  libraryExclusionIds: () => new Set<string>(),
}));
vi.mock('@/hooks/useSession', () => ({ storeParticipantId: vi.fn() }));
vi.mock('@/hooks/useWatchlist', () => ({ useWatchlist: () => ({ items: [] }) }));
vi.mock('@/components/groups/GroupMembersPanel', () => ({
  GroupMembersPanel: () => <div data-testid="group-view" />,
}));
vi.mock('@/components/groups/GroupWatchlistTable', () => ({ GroupWatchlistTable: () => null }));
vi.mock('@/components/lists/ListCheapestPlanPanel', () => ({ default: () => null }));
vi.mock('@/components/groups/GroupSessionHistoryPanel', () => ({ GroupSessionHistoryPanel: () => null }));
vi.mock('@/components/groups/GroupSidePanels', () => ({
  InvitePanel: () => null,
  LeavePanel: () => null,
  ProviderOverlapPanel: () => null,
}));
vi.mock('@/components/groups/HouseholdPanel', () => ({ default: () => null }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    uid: 'me',
    user: { displayName: 'Malin', username: 'malin', photoURL: null, myProviders: [8] },
  }),
}));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: hoisted.usePageMeta }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('invite=tok123'),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
// AuthGuard släpper igenom; barnen är inte ämnet här.
vi.mock('@/components/AuthGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import GroupPageClient from './GroupPageClient';

/** Läget en icke-medlem med en giltig länk landar i: läsningen nekad, namn känt. */
function deniedState() {
  return {
    group: null,
    members: [],
    watchlist: [],
    loading: false,
    notFound: false,
    denied: true,
    publicName: 'Filmklubben',
    resubscribe: hoisted.resubscribe,
  };
}

beforeEach(() => {
  hoisted.resubscribe.mockClear();
  hoisted.joinGroupViaToken.mockReset();
  hoisted.useGroup.mockReset();
  hoisted.useGroup.mockImplementation(() => deniedState());
});

describe('GroupPageClient — ett lyckat join startar om prenumerationen (BIN-1152)', () => {
  it('anropar resubscribe nar joinet lyckas', async () => {
    hoisted.joinGroupViaToken.mockResolvedValue({ ok: true });

    render(<GroupPageClient id="g-1" />);

    // Utan det har anropet ar den doda lyssnaren kvar och skarmen under fastnar
    // pa "du ar inte medlem" — efter att lanken faktiskt fungerat.
    await waitFor(() => expect(hoisted.resubscribe).toHaveBeenCalledTimes(1));
    expect(hoisted.joinGroupViaToken).toHaveBeenCalledTimes(1);
  });

  it('anropar INTE resubscribe nar joinet nekas pa sak', async () => {
    // En trasig eller indragen token andrar inget regelutfall, sa en omstart hade
    // bara kostat en ny nekad lasning. Det negativa fallet ar det som gor det
    // positiva till ett pastaende om `res.ok` och inte om "nagot hande".
    hoisted.joinGroupViaToken.mockResolvedValue({ ok: false, reason: 'invalid_token' });

    render(<GroupPageClient id="g-1" />);

    await waitFor(() => expect(hoisted.joinGroupViaToken).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/Filmklubben/)).toBeTruthy());
    expect(hoisted.resubscribe).not.toHaveBeenCalled();
  });

  it('anropar INTE resubscribe nar joinet foll pa natverket', async () => {
    hoisted.joinGroupViaToken.mockResolvedValue({ ok: false, reason: 'transient' });

    render(<GroupPageClient id="g-1" />);

    await waitFor(() => expect(hoisted.joinGroupViaToken).toHaveBeenCalledTimes(1));
    expect(hoisted.resubscribe).not.toHaveBeenCalled();
  });
});

describe('GroupPageClient — already_member startar ocksa om prenumerationen (BIN-1181)', () => {
  // Två flikar på samma länk: den förlorande fliken får `already_member`, men
  // servern räknar redan kontot som medlem. Testet driver hela övergången — nekad
  // vy, utfallet, omstarten, den nya läsningen — och hävdar att fliken LANDAR i
  // gruppvyn, inte bara att ett anrop gjordes.
  it('landar i gruppvyn efter already_member', async () => {
    hoisted.joinGroupViaToken.mockResolvedValue({ ok: false, reason: 'already_member' });

    const { rerender } = render(<GroupPageClient id="g-1" />);

    await waitFor(() => expect(hoisted.resubscribe).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('group-view')).toBeNull();

    // Omstarten återfyrar inte joinet. Hävdat MEDAN vyn fortfarande är nekad: efter
    // bytet till medlemsvyn stoppar medlemskollen ett nytt join ändå, så en kontroll
    // där hade inte kunnat se om budgeten brändes.
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(hoisted.joinGroupViaToken).toHaveBeenCalledTimes(1);

    // Den nya prenumerationen läser dokumentet som medlem.
    hoisted.useGroup.mockImplementation(() => ({
      ...deniedState(),
      denied: false,
      publicName: null,
      group: {
        id: 'g-1',
        name: 'Filmklubben',
        ownerUid: 'owner',
        memberUids: ['owner', 'me'],
        defaults: { providerMode: 'intersect', aggregation: 'any', mediaType: 'movie' },
      },
    }));
    rerender(<GroupPageClient id="g-1" />);

    await waitFor(() => expect(screen.getByTestId('group-view')).toBeTruthy());
    expect(screen.queryByText(/Du är inte medlem/)).toBeNull();
  });
});
