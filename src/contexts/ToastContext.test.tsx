import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToastProvider, useToast } from './ToastContext';

function Trigger({ action }: { action?: { label: string; onClick: () => void } }) {
  const { show } = useToast();
  return <button onClick={() => show('Testtoast', action)}>visa</button>;
}

describe('ToastProvider', () => {
  it('visar toast med åtgärdsknapp; klick kör handlern och stänger toasten', () => {
    const onClick = vi.fn();
    render(
      <ToastProvider>
        <Trigger action={{ label: 'Rensa helt', onClick }} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('visa'));
    expect(screen.getByText('Testtoast')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Rensa helt' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Testtoast')).toBeNull();
  });

  it('toast utan åtgärd renderar ingen knapp', () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('visa'));
    expect(screen.getByText('Testtoast')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Rensa helt' })).toBeNull();
  });
});
