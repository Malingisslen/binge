import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LandingTopbar from './LandingTopbar';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

describe('LandingTopbar (guest start page)', () => {
  it('offers Logga in and no second search field', () => {
    render(<LandingTopbar />);
    expect(screen.getByRole('button', { name: 'Logga in' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('sends the visitor to /login, never straight into a Google sign-in', () => {
    render(<LandingTopbar />);
    fireEvent.click(screen.getByRole('button', { name: 'Logga in' }));
    expect(push).toHaveBeenCalledWith('/login/');
  });
});
