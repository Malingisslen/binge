import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

// Mocked listener: proves how the provider reacts to the listener's two callbacks.
// It evaluates no Firestore rules.
let fireListener: (outcome: 'denied' | 'empty') => void = () => {};

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ uid: 'u1' }) }));
vi.mock('@/lib/firebase/db', () => ({
  fsdb: vi.fn(),
  lazySubscribe: (attach: (kit: unknown) => () => void) => attach({
    db: {},
    collection: () => ({}),
    onSnapshot: (_ref: unknown, onNext: (snap: { docs: never[] }) => void, onError?: (e: Error) => void) => {
      fireListener = outcome => {
        if (outcome === 'empty') onNext({ docs: [] });
        else onError?.(new Error('permission-denied'));
      };
      return () => {};
    },
  }),
}));

import { NotInterestedProvider, useNotInterested } from './NotInterestedContext';
import { act } from 'react';

function Probe() {
  const { loading } = useNotInterested();
  return <span>{loading ? 'loading' : 'ready'}</span>;
}

const wrap = (ui: ReactNode) => render(<NotInterestedProvider>{ui}</NotInterestedProvider>);

describe('NotInterestedProvider loading', () => {
  it('stops loading when the listener fails, so the recommendations page is not held forever', () => {
    wrap(<Probe />);
    expect(screen.getByText('loading')).toBeTruthy();
    act(() => fireListener('denied'));
    expect(screen.getByText('ready')).toBeTruthy();
  });

  it('stops loading on the first snapshot', () => {
    wrap(<Probe />);
    expect(screen.getByText('loading')).toBeTruthy();
    act(() => fireListener('empty'));
    expect(screen.getByText('ready')).toBeTruthy();
  });
});
