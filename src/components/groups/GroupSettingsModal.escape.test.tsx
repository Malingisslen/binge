// src/components/groups/GroupSettingsModal.escape.test.tsx
//
// Modalens EGEN dokumentspärr mot Escape, ensam.
//
// Syskonfilen driver samma sak med den riktiga överlämningsdialogen monterad, och
// det fallet kan inte falla på det villkor det är döpt efter: dialogen anropar
// `stopImmediatePropagation` innan modalens hanterare hinner köra. Att ta bort
// `&& !handingOver` där överlevde hela sviten; först när BÅDA skydden togs bort
// föll något. Två skydd som bara är pinnade tillsammans är inte pinnade.
//
// Här stubbas dialogen till en passiv ruta utan lyssnare. Då står modalens
// klausul ensam, och den kan falla för sig.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GroupSettingsModal } from './GroupSettingsModal';
import type { GroupMember } from '@/types';

vi.mock('@/lib/firebase/groups', () => ({ updateGroup: vi.fn(async () => {}) }));
vi.mock('@/components/groups/HandOverGroupDialog', () => ({
  HandOverGroupDialog: () => <div data-testid="handover-stub" />,
}));

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

function renderModal(onClose = vi.fn()) {
  render(
    <GroupSettingsModal
      groupId="g1"
      name="Fredagsmys"
      defaults={DEFAULTS}
      members={[member('me', 'Malin'), member('jonas', 'Jonas')]}
      myUid="me"
      onClose={onClose}
      onDelete={vi.fn()}
      onHandedOver={vi.fn()}
    />,
  );
  return onClose;
}

describe('GroupSettingsModal — dokumentspärren utan dialogens eget skydd (BIN-1118)', () => {
  beforeEach(() => vi.clearAllMocks());

  // Kontrollen. Utan den hade en modal som ALDRIG stänger på Escape uppfyllt
  // fallet nedan.
  it('stänger modalen på Escape när ingen dialog är öppen', () => {
    const onClose = renderModal();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stänger INTE modalen medan överlämningen är öppen', () => {
    const onClose = renderModal();
    fireEvent.click(screen.getByText('Lämna över'));
    expect(screen.getByTestId('handover-stub')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
