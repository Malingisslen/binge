// src/components/home/VannerTile.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import VannerTile from './VannerTile';

// BIN-1345. Startsidans Vänner-ruta lämnar ute den jag har blockerat, som
// Vänner-sidan redan gör (BIN-1341).

const data = vi.hoisted(() => ({
  friends: [] as { uid: string; displayName: string; username?: string; since: Date }[],
  blocked: new Set<string>(),
}));

vi.mock('@/hooks/useFriends', () => ({
  useFriends: () => ({ data: data.friends, isLoading: false }),
}));
vi.mock('@/hooks/useBlockedUsers', () => ({
  useBlockedUsers: () => ({ isBlocked: (uid: string) => data.blocked.has(uid) }),
}));

const friend = (uid: string, displayName: string) => ({ uid, displayName, since: new Date() });

beforeEach(() => {
  data.friends = [];
  data.blocked = new Set();
});

describe('VannerTile', () => {
  it('leaves out a friend I have blocked', () => {
    data.friends = [friend('anna', 'Anna'), friend('blockad', 'Blockad')];
    data.blocked = new Set(['blockad']);
    const { queryByText } = render(<VannerTile />);

    expect(queryByText('Anna')).not.toBeNull();
    expect(queryByText('Blockad')).toBeNull();
  });

  it('shows the empty state when the only friend is blocked', () => {
    data.friends = [friend('blockad', 'Blockad')];
    data.blocked = new Set(['blockad']);
    const { queryByText } = render(<VannerTile />);

    expect(queryByText('Blockad')).toBeNull();
    expect(queryByText(/Du har inga vänner än/)).not.toBeNull();
  });

  it('fills the four rows from friends who are not blocked', () => {
    data.friends = [
      friend('blockad', 'Blockad'),
      friend('a', 'A1'), friend('b', 'B1'), friend('c', 'C1'), friend('d', 'D1'),
    ];
    data.blocked = new Set(['blockad']);
    const { container } = render(<VannerTile />);

    expect(container.querySelectorAll('li')).toHaveLength(4);
    expect(container.textContent).toContain('D1');
  });
});
