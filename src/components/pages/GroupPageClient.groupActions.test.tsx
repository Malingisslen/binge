import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';

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
  captureError: vi.fn(),
  readInviteToken: vi.fn(() => null as string | null),
}));

vi.mock('@/lib/sentry', () => ({ captureError: hoisted.captureError }));
// `InvitePanel` läser inbjudningslänkens klartext ur en lokal cache. Styrd här så
// ägarläget har en länk att kopiera; ingen annan del av sidan läser cachen.
vi.mock('@/lib/groupInviteCache', () => ({
  readInviteToken: hoisted.readInviteToken,
  cacheInviteToken: vi.fn(),
  clearInviteToken: vi.fn(),
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

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  // `clearAllMocks` rensar anrop, inte implementationer — utan återställningen
  // hade `heldClipboard()`s aldrig lösta promise följt med till nästa test (BIN-1273).
  hoisted.writeText.mockReset();
  hoisted.readInviteToken.mockImplementation(() => null);
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
    // BIN-1272: skrivfelet når Sentry under ett eget kind, skilt från navigeringens.
    expect(hoisted.captureError).toHaveBeenCalledWith(expect.any(Error), {
      scope: 'groups',
      kind: 'leaveGroup-write',
    });
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
    // BIN-1264: kastet rapporteras till Sentry under ett EGET kind — inte som ett
    // misslyckat utträde — och dialogen stänger ändå.
    expect(hoisted.captureError).toHaveBeenCalledWith(expect.any(Error), {
      scope: 'groups',
      kind: 'leaveGroup-navigation',
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ett lyckat utträde rapporterar ingenting', async () => {
    render(<GroupPageClient id="g-1" />);
    await screen.findByTestId('group-view');

    fireEvent.click(screen.getByLabelText('Åtgärder'));
    fireEvent.click(screen.getByText('Lämna gruppen'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lämna gruppen' }));

    await waitFor(() => expect(hoisted.push).toHaveBeenCalledWith('/grupper'));
    expect(hoisted.captureError).not.toHaveBeenCalled();
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

/**
 * BIN-1262 — "Kopierad."-bekräftelsen, på båda ställena den finns. Den är ett
 * kortlivat mellanläge, så den drivs hold → observera → släpp: urklippet hålls på
 * en styrbar promise, bekräftelsen läses medan den står, och klockan flyttas förbi
 * 1,5 s för att se den gå tillbaka.
 */
function heldClipboard() {
  let release: () => void = () => {};
  hoisted.writeText.mockImplementation(
    () => new Promise<void>(resolve => { release = resolve; }),
  );
  return () => release();
}

function ownerState(rotatedAt: Date) {
  const state = memberState();
  return {
    ...state,
    group: { ...state.group, ownerUid: 'me', inviteTokenHash: 'hash', inviteTokenRotatedAt: rotatedAt },
  };
}

describe('GroupPageClient — "Kopiera länk" bekräftar och går tillbaka (BIN-1262)', () => {
  it('visar "Kopierad." först när urklippet svarat, och går tillbaka efter 1,5 s', async () => {
    render(<GroupPageClient id="g-1" />);
    await screen.findByTestId('group-view');
    vi.useFakeTimers();
    const release = heldClipboard();

    fireEvent.click(screen.getByText('Kopiera länk'));
    // Hold: urklippet har inte svarat, så ingenting är bekräftat än.
    expect(screen.queryByText('Kopierad.')).toBeNull();

    await act(async () => { release(); });
    expect(screen.getByText('Kopierad.')).toBeTruthy();

    act(() => { vi.advanceTimersByTime(1499); });
    expect(screen.getByText('Kopierad.')).toBeTruthy();

    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByText('Kopierad.')).toBeNull();
    expect(screen.getByText('Kopiera länk')).toBeTruthy();
  });

  it('ett nekat urklipp kastar inte vidare och lämnar knappen oförändrad', async () => {
    render(<GroupPageClient id="g-1" />);
    await screen.findByTestId('group-view');
    hoisted.writeText.mockRejectedValueOnce(new Error('NotAllowedError'));

    await act(async () => { fireEvent.click(screen.getByText('Kopiera länk')); });

    expect(hoisted.writeText).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Kopierad.')).toBeNull();
    expect(screen.getByText('Kopiera länk')).toBeTruthy();
  });
});

describe('InvitePanel — inbjudningslänkens kopieringsknapp bekräftar och går tillbaka (BIN-1262)', () => {
  // Nyss roterad, så panelens automatiska rotation inte löser ut — den skulle
  // anropa en skrivväg den här filen inte mockar.
  beforeEach(() => {
    hoisted.useGroup.mockImplementation(() => ownerState(new Date()));
    hoisted.readInviteToken.mockImplementation(() => 'plain123');
  });

  it('visar "Kopierad." först när urklippet svarat, och tar bort den efter 1,5 s', async () => {
    render(<GroupPageClient id="g-1" />);
    const copyButton = await screen.findByTitle('Kopiera');
    vi.useFakeTimers();
    const release = heldClipboard();

    fireEvent.click(copyButton);
    expect(hoisted.writeText).toHaveBeenCalledWith('https://binge.nu/grupper/g-1?invite=plain123');
    expect(screen.queryByText('Kopierad.')).toBeNull();

    await act(async () => { release(); });
    expect(screen.getByText('Kopierad.')).toBeTruthy();

    act(() => { vi.advanceTimersByTime(1499); });
    expect(screen.getByText('Kopierad.')).toBeTruthy();

    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByText('Kopierad.')).toBeNull();
  });

  it('ett nekat urklipp kastar inte vidare och visar ingen bekräftelse', async () => {
    render(<GroupPageClient id="g-1" />);
    const copyButton = await screen.findByTitle('Kopiera');
    hoisted.writeText.mockRejectedValueOnce(new Error('NotAllowedError'));

    await act(async () => { fireEvent.click(copyButton); });

    expect(hoisted.writeText).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Kopierad.')).toBeNull();
  });
});
