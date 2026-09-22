// src/components/moderation/UgcActionsMenu.test.tsx
//
// BIN-1211. Dialogens rubrik hette "Rapportera innehåll" oavsett måltyp. Det var oskyldigt
// så länge menyn bara satt på recensioner och kommentarer; profilen gör målet till en
// PERSON, och då är ordet fel.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UgcActionsMenu } from './UgcActionsMenu';

vi.mock('@/lib/firebase/config', () => ({ auth: {}, default: {} }));

const createReport = vi.hoisted(() => vi.fn());
const show = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ uid: 'me' }) }));
vi.mock('@/hooks/useBlockedUsers', () => ({
  useBlockedUsers: () => ({ isBlocked: () => false, blockUser: vi.fn(), unblockUser: vi.fn() }),
}));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ show }) }));
vi.mock('@/lib/firebase/reports', () => ({
  createReport,
  REPORT_REASON_LABELS: { spam: 'Spam / reklam', other: 'Annat' },
}));

function openDialog() {
  fireEvent.click(screen.getByLabelText('Åtgärder'));
  fireEvent.click(screen.getByText('Rapportera'));
  return screen.getByRole('dialog');
}

describe('UgcActionsMenu — rubriken följer måltypen (BIN-1211)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('en anmälan mot en person heter inte "innehåll"', () => {
    render(<UgcActionsMenu targetType="user" targetId="them" targetOwnerUid="them" />);
    const dialog = openDialog();
    expect(dialog.textContent).toContain('Rapportera användare');
    expect(dialog.textContent).not.toContain('Rapportera innehåll');
  });

  it('en anmälan mot en recension heter fortfarande "innehåll"', () => {
    render(<UgcActionsMenu targetType="review" targetId="r1" targetOwnerUid="them" />);
    const dialog = openDialog();
    expect(dialog.textContent).toContain('Rapportera innehåll');
    expect(dialog.textContent).not.toContain('Rapportera användare');
  });

  // Självgatningen är det som gör att knappen på profilen inte behöver ett eget
  // isOwnProfile-villkor. Utan det här testet kan den tas bort tyst.
  it('menyn visas inte på ens eget innehåll', () => {
    const { container } = render(
      <UgcActionsMenu targetType="user" targetId="me" targetOwnerUid="me" />,
    );
    expect(container.firstChild).toBeNull();
  });
});

// BIN-1120. Gruppsidan monterar SAMMA meny, med en extrapost och utan
// blockeringen. De tre proppar som gör det är nya, och varje gren nedan är en
// yta som annars bara hade prövats genom en mock som returnerar null.
describe('UgcActionsMenu — gruppytan (BIN-1120)', () => {
  beforeEach(() => vi.clearAllMocks());

  const renderGroupMenu = (onSelect = vi.fn()) => {
    render(
      <UgcActionsMenu
        targetType="group"
        targetId="g1"
        targetOwnerUid="them"
        triggerLabel="Mer"
        showBlock={false}
        extraItems={[
          { key: 'leave', label: 'Lämna gruppen', icon: <span />, danger: true, onSelect },
        ]}
      />,
    );
    return onSelect;
  };

  it('knappen bär ordet Mer, så den inte läses som dekoration', () => {
    renderGroupMenu();
    expect(screen.getByLabelText('Åtgärder').textContent).toContain('Mer');
  });

  it('en gruppmeny erbjuder ingen blockering', () => {
    renderGroupMenu();
    fireEvent.click(screen.getByLabelText('Åtgärder'));
    expect(screen.queryByText('Blockera användare')).toBeNull();
    expect(screen.queryByText('Avblockera')).toBeNull();
  });

  it('den andra menyn visar fortfarande blockeringen', () => {
    // Kontrollen åt andra hållet: utan den hade en trasig gren som alltid
    // gömmer knappen uppfyllt testet ovan lika bra.
    render(<UgcActionsMenu targetType="review" targetId="r1" targetOwnerUid="them" />);
    fireEvent.click(screen.getByLabelText('Åtgärder'));
    expect(screen.getByText('Blockera användare')).toBeTruthy();
  });

  it('en extrapost körs och stänger menyn', () => {
    const onSelect = renderGroupMenu();
    fireEvent.click(screen.getByLabelText('Åtgärder'));
    fireEvent.click(screen.getByText('Lämna gruppen'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Lämna gruppen')).toBeNull();
  });

  it('menyraden och dialogrubriken namnger gruppen, inte "innehåll"', () => {
    renderGroupMenu();
    fireEvent.click(screen.getByLabelText('Åtgärder'));
    fireEvent.click(screen.getByText('Anmäl gruppen'));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Anmäl gruppen');
    expect(dialog.textContent).not.toContain('Rapportera innehåll');
  });

  it('gruppdialogen erbjuder varje skäl koden har, inte en egen lista', () => {
    // Den parallella listan är felet som ska uteslutas: dialogen ska läsa
    // REPORT_REASON_LABELS, vad den än innehåller.
    renderGroupMenu();
    fireEvent.click(screen.getByLabelText('Åtgärder'));
    fireEvent.click(screen.getByText('Anmäl gruppen'));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Spam / reklam');
    expect(dialog.textContent).toContain('Annat');
  });

  it('ägaren ser ingen meny på sin egen grupp', () => {
    render(<UgcActionsMenu targetType="group" targetId="g1" targetOwnerUid="me" triggerLabel="Mer" />);
    expect(screen.queryByLabelText('Åtgärder')).toBeNull();
  });
});
