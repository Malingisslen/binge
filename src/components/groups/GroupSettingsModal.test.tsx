// src/components/groups/GroupSettingsModal.test.tsx
//
// BIN-1118. Modalen hade inget test alls, och överlämningen lade tre saker i den
// som bara syns här: vilka som erbjuds som efterträdare, att knappen är avstängd
// när det inte finns någon att välja, och att Escape inte river undan
// överlämningsdialogen medan ett anrop ligger i luften.
//
// Escape-halvan prövas åt BÅDA hållen och på BÅDA vägarna. Filen har två — en
// dokumentlyssnare och bakgrundens egen `onKeyDown` — och den andra glömdes
// första gången, vilket är precis varför båda står här.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GroupSettingsModal } from './GroupSettingsModal';
import type { GroupMember } from '@/types';
import { handOverGroup } from '@/lib/firebase/groupHandover';
import { updateGroup } from '@/lib/firebase/groups';

vi.mock('@/lib/firebase/groups', () => ({ updateGroup: vi.fn(async () => {}) }));
vi.mock('@/lib/firebase/groupHandover', () => ({ handOverGroup: vi.fn(async () => {}) }));

const member = (uid: string, displayName: string): GroupMember => ({
  uid,
  displayName,
  username: null,
  photoURL: null,
  providers: [],
  joinedAt: new Date('2024-03-04'),
  joinedAtKnown: true,
});

const DEFAULTS = { providerMode: 'all', aggregation: 'union', mediaType: 'both' } as never;

function renderModal(
  members: GroupMember[], onClose = vi.fn(), onHandedOver = vi.fn(),
  memberUids: string[] = members.map(m => m.uid),
) {
  render(
    <GroupSettingsModal
      groupId="g1"
      name="Fredagsmys"
      defaults={DEFAULTS}
      members={members}
      memberUids={memberUids}
      myUid="me"
      onClose={onClose}
      onDelete={vi.fn()}
      onHandedOver={onHandedOver}
    />,
  );
  return onClose;
}

const ME = member('me', 'Malin');
const JONAS = member('jonas', 'Jonas');
const SARA = member('sara', 'Sara');

describe('GroupSettingsModal — överlämningen (BIN-1118)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('erbjuder varje medlem UTOM ägaren som efterträdare', () => {
    renderModal([ME, JONAS, SARA]);
    fireEvent.click(screen.getByText('Lämna över'));
    const dialog = screen.getByRole('dialog', { name: /tar över gruppen/ });
    expect(dialog.textContent).toContain('Jonas');
    expect(dialog.textContent).toContain('Sara');
    expect(dialog.textContent).not.toContain('Malin');
  });

  // BIN-1269. En strandad medlemsrad (raden finns, uid:t står inte längre i
  // gruppens memberUids) erbjöds förut och nekades sedan av servern.
  it('erbjuder inte en medlemsrad vars uid saknas i gruppens memberUids', () => {
    renderModal([ME, JONAS, SARA], vi.fn(), vi.fn(), ['me', 'jonas']);
    fireEvent.click(screen.getByText('Lämna över'));
    const dialog = screen.getByRole('dialog', { name: /tar över gruppen/ });
    expect(dialog.textContent).toContain('Jonas');
    expect(dialog.textContent).not.toContain('Sara');
  });

  it('stänger av knappen när den enda andra raden är strandad', () => {
    renderModal([ME, SARA], vi.fn(), vi.fn(), ['me']);
    expect(screen.getByText('Lämna över').closest('button')).toBeDisabled();
  });

  // En ägare ensam i sin grupp har ingen att peka ut. Knappen ska vara avstängd
  // snarare än att öppna en tom lista — "Radera grupp" står bredvid och är det
  // ärliga valet där.
  it('stänger av knappen när ägaren är ensam', () => {
    renderModal([ME]);
    expect(screen.getByText('Lämna över').closest('button')).toBeDisabled();
  });

  it('knappen är på så fort det finns en enda annan medlem', () => {
    renderModal([ME, JONAS]);
    expect(screen.getByText('Lämna över').closest('button')).not.toBeDisabled();
  });

  // Ledet mellan dialogen och sidan. Dialogens egen fil provar att `onDone` kallas;
  // den kan inte se VAD modalen skickar in dar. En modal som skickar in `onClose`
  // i stallet ser likadan ut pa skarmen och lamnar bada filerna grona.
  it('dialogens klarsignal nar modalens onHandedOver, inte onClose', async () => {
    const onClose = vi.fn();
    const onHandedOver = vi.fn();
    renderModal([ME, JONAS], onClose, onHandedOver);

    fireEvent.click(screen.getByText('Lämna över'));
    fireEvent.click(screen.getByText('Lämna över till Jonas'));

    await waitFor(() => expect(onHandedOver).toHaveBeenCalledTimes(1));
    expect(handOverGroup).toHaveBeenCalledWith('g1', 'jonas');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('överlämningen står FÖRE raderingen i sidfoten', () => {
    renderModal([ME, JONAS]);
    const html = screen.getByRole('dialog', { name: 'Gruppinställningar' }).innerHTML;
    expect(html.indexOf('Lämna över')).toBeLessThan(html.indexOf('Radera grupp'));
  });
});

describe('GroupSettingsModal — sparningen', () => {
  beforeEach(() => vi.clearAllMocks());

  // Ett nekande blev nabart med den har bunten: lyckas overlamningen men faller
  // navigeringen star modalen kvar for en grupp anroparen inte langre ager, och
  // reglerna nekar `updateGroup`. Utan en fangst var det ett ohanterat fel med
  // ingenting pa skarmen — modalen stangde inte heller, sa det sag ut som att
  // knappen inte gjorde nagot.
  it('visar ett fel och stänger inte när sparningen nekas', async () => {
    const onClose = vi.fn();
    (updateGroup as unknown as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('permission-denied'));
    renderModal([ME, JONAS], onClose);

    fireEvent.click(screen.getByText('Spara'));

    expect(await screen.findByText(/kunde inte sparas/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Spara').closest('button')).not.toBeDisabled();
  });

  // Kontrollen. Utan den hade en modal som ALDRIG stanger uppfyllt fallet ovan.
  it('stänger när sparningen går igenom', async () => {
    const onClose = vi.fn();
    renderModal([ME, JONAS], onClose);

    fireEvent.click(screen.getByText('Spara'));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/kunde inte sparas/)).not.toBeInTheDocument();
  });
});

describe('GroupSettingsModal — Escape', () => {
  beforeEach(() => vi.clearAllMocks());

  // Kontrollen som gör de två följande meningsfulla: utan den hade en modal som
  // ALDRIG stänger på Escape uppfyllt dem båda.
  it('stänger modalen när ingen dialog är öppen', () => {
    const onClose = renderModal([ME, JONAS]);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stänger INTE modalen medan överlämningen är öppen — dokumentvägen', () => {
    const onClose = renderModal([ME, JONAS]);
    fireEvent.click(screen.getByText('Lämna över'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  // BIN-1261: med den riktiga dialogen monterad stoppar dess skal tangenten först,
  // så det här fallet pinnar inte bakgrundens klausul. Den pinnas i
  // `GroupSettingsModal.escape.test.tsx`, där dialogen är stubbad.
  it('stänger INTE modalen medan överlämningen är öppen — bakgrundsvägen', () => {
    const onClose = renderModal([ME, JONAS]);
    const trigger = screen.getByText('Lämna över');
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  // Kontrollen som gor fallet ovan meningsfullt: SAMMA element, samma tangent,
  // utan att nagon dialog ar oppen. Stanger den inte har ar vagen dod och det
  // negativa fallet mater ingenting.
  //
  // Bada hanterarna svarar pa ett Escape harifran — bakgrundens, och
  // dokumentlyssnaren som handelsen ocksa nar — sa antalet ar tva, inte ett.
  // Det ar just darfor bada behover var sin sparr, och varfor den har filen
  // driver bada vagarna var for sig.
  it('bakgrundsvägen stänger modalen när ingen dialog är öppen', () => {
    const onClose = renderModal([ME, JONAS]);
    fireEvent.keyDown(screen.getByText('Lämna över'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('stänger INTE modalen medan raderingsbekräftelsen är öppen', () => {
    const onClose = renderModal([ME, JONAS]);
    fireEvent.click(screen.getByText('Radera grupp'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
