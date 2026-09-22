import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

/**
 * BIN-1120/1118 — gruppsidans två nya åtgärder, prövade där de KOPPLAS IHOP.
 *
 * Systerfilen `GroupPageClient.joinResubscribe.test.tsx` mockar bort menyn och
 * utträdesdialogen, eftersom dess ämne är joinet. Här är de OMOCKADE, för det är
 * just kopplingen som är ämnet: en `extraItems`-post som renderas men aldrig når
 * `LeaveGroupDialog`, eller en dialog som får fel `groupId`, är osynlig för
 * komponenternas egna test och för sidans.
 *
 * Kopieringsknappen är den andra halvan, och den är säkerhetsrelevant. Sidan tar
 * ALDRIG bort `?invite=<token i klartext>` ur adressen — den läser bara
 * parametern — så en knapp som kopierar hela adressen delar ut ett levande
 * join-token till var den än klistras. `location.href` är den uppenbara
 * implementationen, alltså den en framtida redigering sannolikt återinför.
 */

vi.mock('@/lib/firebase/config', () => ({ auth: {}, default: {} }));

const hoisted = vi.hoisted(() => ({
  useGroup: vi.fn(),
  leaveGroup: vi.fn(async () => {}),
  push: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock('@/hooks/useGroups', () => ({
  useGroup: hoisted.useGroup,
  useMyGroups: () => ({ groups: [], loading: false }),
  useMyGroupInvites: () => ({ invites: [], loading: false, accept: vi.fn(), decline: vi.fn() }),
}));
vi.mock('@/lib/firebase/groups', () => ({
  joinGroupViaToken: vi.fn(),
  deleteGroup: vi.fn(),
  leaveGroup: hoisted.leaveGroup,
  GROUP_WRITE_REFUSED: 'binge/group-write-refused',
  MY_GROUPS_LIMIT: 100,
}));
vi.mock('@/lib/firebase/sessions', () => ({ createSession: vi.fn(), setSessionCandidates: vi.fn() }));
vi.mock('@/lib/together/candidates', () => ({
  computeSessionProviders: () => [],
  generateCandidates: vi.fn(),
  libraryExclusionIds: () => new Set<string>(),
}));
vi.mock('@/hooks/useSession', () => ({ storeParticipantId: vi.fn() }));
vi.mock('@/hooks/useWatchlist', () => ({ useWatchlist: () => ({ items: [] }) }));
// Panelerna är inte ämnet. Menyn, utträdesdialogen och kopieringsknappen är
// medvetet INTE mockade — de är det som prövas.
vi.mock('@/components/groups/GroupMembersPanel', () => ({
  GroupMembersPanel: () => <div data-testid="group-view" />,
}));
vi.mock('@/components/groups/GroupWatchlistTable', () => ({ GroupWatchlistTable: () => null }));
vi.mock('@/components/lists/ListCheapestPlanPanel', () => ({ default: () => null }));
vi.mock('@/components/groups/GroupSessionHistoryPanel', () => ({ GroupSessionHistoryPanel: () => null }));
vi.mock('@/components/groups/HouseholdPanel', () => ({ default: () => null }));
vi.mock('@/hooks/useBlockedUsers', () => ({
  useBlockedUsers: () => ({ isBlocked: () => false, blockUser: vi.fn(), unblockUser: vi.fn() }),
}));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock('@/lib/firebase/reports', () => ({
  createReport: vi.fn(),
  REPORT_REASON_LABELS: { spam: 'Spam / reklam', other: 'Annat' },
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    uid: 'me',
    user: { displayName: 'Malin', username: 'malin', photoURL: null, myProviders: [8] },
  }),
}));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: vi.fn() }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('invite=tok123'),
  useRouter: () => ({ push: hoisted.push, replace: vi.fn() }),
}));
vi.mock('@/components/AuthGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import GroupPageClient from './GroupPageClient';

/** Inloggad som `me`, medlem men inte ägare — det läge menyn renderas i. */
function memberState() {
  return {
    group: {
      id: 'g-1',
      name: 'Filmklubben',
      ownerUid: 'owner',
      memberUids: ['owner', 'me'],
      defaults: { providerMode: 'intersect', aggregation: 'any', mediaType: 'movie' },
    },
    members: [],
    watchlist: [],
    loading: false,
    notFound: false,
    denied: false,
    publicName: null,
    resubscribe: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.useGroup.mockImplementation(() => memberState());
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      origin: 'https://binge.nu',
      pathname: '/grupper/g-1/',
      href: 'https://binge.nu/grupper/g-1/?invite=tok123',
      search: '?invite=tok123',
    },
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: hoisted.writeText },
  });
});

describe('GroupPageClient — kopieringsknappen lämnar inte ut inbjudningstokenet (BIN-1120)', () => {
  it('kopierar adressen UTAN frågesträngen', async () => {
    render(<GroupPageClient id="g-1" />);
    await screen.findByTestId('group-view');

    fireEvent.click(screen.getByText('Kopiera länk'));
    expect(hoisted.writeText).toHaveBeenCalledWith('https://binge.nu/grupper/g-1/');
  });

  // Den negativa halvan, och den som fäller en återgång till `location.href`.
  // Adressen i fixturen BÄR ett token, så en implementation som kopierar hela
  // adressen ger en sträng som innehåller det.
  it('den kopierade strängen bär varken parametern eller tokenet', async () => {
    render(<GroupPageClient id="g-1" />);
    await screen.findByTestId('group-view');

    fireEvent.click(screen.getByText('Kopiera länk'));
    const copied = hoisted.writeText.mock.calls[0][0] as string;
    expect(copied).not.toContain('invite');
    expect(copied).not.toContain('tok123');
    expect(copied).not.toContain('?');
  });

  // Kontrollen som gör de två ovan meningsfulla: fixturens adress innehåller
  // faktiskt tokenet, så testet mäter en strykning och inte en tom sträng.
  it('fixturens adress bär tokenet, så frånvaron ovan är mätt', () => {
    expect(window.location.href).toContain('tok123');
    expect(window.location.pathname).not.toContain('tok123');
  });

  it('knappen sitter utanför åtgärdsmenyn, så ägaren också når den', async () => {
    hoisted.useGroup.mockImplementation(() => ({
      ...memberState(),
      group: { ...memberState().group, ownerUid: 'me' },
    }));
    render(<GroupPageClient id="g-1" />);
    await screen.findByTestId('group-view');

    // Menyn döljer sig för den som äger det anmälda; kopieringen ska ändå finnas.
    expect(screen.queryByLabelText('Åtgärder')).toBeNull();
    expect(screen.getByText('Kopiera länk')).toBeTruthy();
  });
});

describe('GroupPageClient — utträdet når hela vägen från menyn (BIN-1120)', () => {
  it('Mer → Lämna gruppen → bekräfta lämnar gruppen och navigerar bort', async () => {
    render(<GroupPageClient id="g-1" />);
    await screen.findByTestId('group-view');

    fireEvent.click(screen.getByLabelText('Åtgärder'));
    fireEvent.click(screen.getByText('Lämna gruppen'));

    // Bekräftelsens egen knapp, inte menyposten med samma text.
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lämna gruppen' }));

    // Det avgörande: rätt groupId och rätt uid når skrivvägen. En koppling som
    // renderar dialogen med fel värden ser identisk ut på skärmen.
    await waitFor(() => expect(hoisted.leaveGroup).toHaveBeenCalledWith('g-1', 'me'));
    await waitFor(() => expect(hoisted.push).toHaveBeenCalledWith('/grupper'));
  });

  // Den gamla panelen stängde i ett `finally`, alltså även när skrivningen föll.
  // Det var uthärdligt när en alltid synlig knapp satt kvar bakom den; nu ligger
  // omförsöket två klick in i menyn, så en tyst stängning lämnar inget spår av
  // att något misslyckades.
  it('en misslyckad utträdesskrivning stänger inte dialogen, den säger till', async () => {
    hoisted.leaveGroup.mockRejectedValueOnce(new Error('nej'));
    render(<GroupPageClient id="g-1" />);
    await screen.findByTestId('group-view');

    fireEvent.click(screen.getByLabelText('Åtgärder'));
    fireEvent.click(screen.getByText('Lämna gruppen'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lämna gruppen' }));

    await screen.findByText(/gick inte att lämna gruppen/);
    expect(hoisted.push).not.toHaveBeenCalledWith('/grupper');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  // Skälet till att `onLeft()` och `onCancel()` flyttades UT ur sitt `try`.
  // Låg de kvar inuti fångade `leaveGroup`s `catch` ett kast från navigeringen
  // och visade "det gick inte att lämna gruppen" — över en skrivning som redan
  // gått igenom. Utan det här fallet går omflyttningen att backa med sviten
  // grön, eftersom både den gamla och den nya koden ser likadana ut så länge
  // `router.push` inte kastar.
  it('ett kast från navigeringen rapporteras inte som ett misslyckat utträde', async () => {
    hoisted.push.mockImplementationOnce(() => { throw new Error('navigeringen sprack'); });
    render(<GroupPageClient id="g-1" />);
    await screen.findByTestId('group-view');

    fireEvent.click(screen.getByLabelText('Åtgärder'));
    fireEvent.click(screen.getByText('Lämna gruppen'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lämna gruppen' }));

    await waitFor(() => expect(hoisted.leaveGroup).toHaveBeenCalledWith('g-1', 'me'));
    // Skrivningen gick igenom. Felrutan får inte säga motsatsen, och utträdet
    // får inte försökas en andra gång.
    expect(screen.queryByText(/gick inte att lämna gruppen/)).toBeNull();
    expect(hoisted.leaveGroup).toHaveBeenCalledTimes(1);
  });

  it('ägaren erbjuds ingen meny, och därmed ingen väg att lämna utan överlämning', async () => {
    hoisted.useGroup.mockImplementation(() => ({
      ...memberState(),
      group: { ...memberState().group, ownerUid: 'me' },
    }));
    render(<GroupPageClient id="g-1" />);
    await screen.findByTestId('group-view');

    expect(screen.queryByLabelText('Åtgärder')).toBeNull();
    expect(hoisted.leaveGroup).not.toHaveBeenCalled();
  });
});
