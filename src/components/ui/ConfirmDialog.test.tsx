import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renderar titel, brödtext och knappar', () => {
    render(
      <ConfirmDialog
        title="Radera grupp?"
        body="Det går inte att ångra."
        confirmLabel="Radera"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Radera grupp?')).toBeInTheDocument();
    expect(screen.getByText('Det går inte att ångra.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Radera' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Avbryt' })).toBeInTheDocument();
  });

  it('anropar onConfirm vid bekräfta och onCancel vid avbryt', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog title="Ta bort?" confirmLabel="Ta bort" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ta bort' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Avbryt' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('stänger på Escape', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog title="Lämna gruppen?" confirmLabel="Lämna" onConfirm={() => {}} onCancel={onCancel} />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('stänger på backdrop-klick men inte på klick i dialogen', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog title="Säker?" confirmLabel="Ja" onConfirm={() => {}} onCancel={onCancel} />,
    );
    // Klick inuti dialogen → ingen dismiss
    fireEvent.click(screen.getByText('Säker?'));
    expect(onCancel).not.toHaveBeenCalled();
    // Klick direkt på backdrop (mousedown + click på samma element) → dismiss
    const backdrop = screen.getByTestId('confirm-backdrop');
    fireEvent.mouseDown(backdrop, { target: backdrop });
    fireEvent.click(backdrop, { target: backdrop });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('bekräfta-knappen använder btn-danger som default', () => {
    render(
      <ConfirmDialog title="Radera?" confirmLabel="Radera" onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Radera' }).className).toContain('btn-danger');
  });

  it('busy disablar knapparna', () => {
    render(
      <ConfirmDialog title="Radera?" confirmLabel="Radera" busy onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Radera' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Avbryt' })).toBeDisabled();
  });

  it('återlämnar fokus till föregående element vid avmontering', () => {
    // Sätt upp ett element som har fokus innan dialogen monteras
    document.body.innerHTML = '<button id="trigger">Öppna</button>';
    const trigger = document.getElementById('trigger') as HTMLButtonElement;
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = render(
      <ConfirmDialog title="Fokustest" confirmLabel="OK" onConfirm={() => {}} onCancel={() => {}} />,
    );
    // Dialogen ska ha stulit fokus
    expect(document.activeElement).not.toBe(trigger);

    // Vid avmontering ska fokus återlämnas till trigger
    unmount();
    expect(document.activeElement).toBe(trigger);
  });

  // Drag-gesture (mousedown inuti dialog → mouseup/click på backdrop):
  // Testas inte här — jsdom simulerar inte dragsequences realistiskt nog
  // (e.target på syntetiska events reflekterar inte verkliga drag-semantik).
  // Beteendet verifieras manuellt: mouseDownOnBackdrop-ref sätts bara om
  // mousedown träffar backdrop direkt, och click-handlern kräver båda villkoren.
});
