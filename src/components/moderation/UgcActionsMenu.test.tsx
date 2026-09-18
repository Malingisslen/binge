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
