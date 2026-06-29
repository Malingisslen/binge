import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastProvider, useToast } from './ToastContext';

function Trigger({ action }: { action?: { label: string; onClick: () => void } }) {
  const { show } = useToast();
  return <button onClick={() => show('Testtoast', action)}>visa</button>;
}

function RatingTrigger({ onRate }: { onRate: (n: number) => void }) {
  const { showRating } = useToast();
  return <button onClick={() => showRating('Betygsätt Dune?', onRate)}>betygsätt</button>;
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

  // BIN-325: the live region must announce only the NEW toast, not re-read the
  // whole stack on every change — so aria-atomic must be "false" (not "true"),
  // with a polite live region.
  it('live-regionen är polite och icke-atomic (annonserar bara nya toasts)', () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    const region = screen.getByRole('region', { name: 'Aviseringar' });
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('aria-atomic')).toBe('false');
    // and a shown toast renders inside that region
    fireEvent.click(screen.getByText('visa'));
    expect(region.textContent).toContain('Testtoast');
  });
});

describe('ToastProvider showRating (betyg-vid-sedd)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('renderar meddelande + tryckbara stjärnor; klick kör onRate och stänger toasten', () => {
    const onRate = vi.fn();
    render(
      <ToastProvider>
        <RatingTrigger onRate={onRate} />
      </ToastProvider>,
    );
    act(() => { fireEvent.click(screen.getByText('betygsätt')); });
    expect(screen.getByText('Betygsätt Dune?')).toBeTruthy();

    const stars = document.querySelectorAll('span[class*="cursor-pointer"]');
    expect(stars.length).toBe(5);
    // jsdom getBoundingClientRect är noll → klick landar på en hel stjärna.
    act(() => { fireEvent.click(stars[3]); });

    expect(onRate).toHaveBeenCalledWith(4);
    expect(screen.queryByText('Betygsätt Dune?')).toBeNull();
  });

  it('stäng-knappen avfärdar toasten utan att sätta betyg', () => {
    const onRate = vi.fn();
    render(
      <ToastProvider>
        <RatingTrigger onRate={onRate} />
      </ToastProvider>,
    );
    act(() => { fireEvent.click(screen.getByText('betygsätt')); });
    expect(screen.getByText('Betygsätt Dune?')).toBeTruthy();

    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Stäng' })); });
    expect(screen.queryByText('Betygsätt Dune?')).toBeNull();
    expect(onRate).not.toHaveBeenCalled();
  });

  it('självdör efter 6 s utan att anropa onRate', () => {
    const onRate = vi.fn();
    render(
      <ToastProvider>
        <RatingTrigger onRate={onRate} />
      </ToastProvider>,
    );
    act(() => { fireEvent.click(screen.getByText('betygsätt')); });
    expect(screen.getByText('Betygsätt Dune?')).toBeTruthy();

    act(() => { vi.advanceTimersByTime(6000); });
    expect(screen.queryByText('Betygsätt Dune?')).toBeNull();
    expect(onRate).not.toHaveBeenCalled();
  });
});
