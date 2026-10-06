import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const setPauseReminder = vi.fn();
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ setPauseReminder }) }));
const toast = vi.fn();
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ show: toast }) }));
vi.mock('@/lib/utils', () => ({ formatSwedishDate: () => '12 dec' }));

import PauseReminderPrompt from './PauseReminderPrompt';

describe('PauseReminderPrompt (BIN-1442)', () => {
  beforeEach(() => { setPauseReminder.mockReset(); toast.mockReset(); });

  const prompt = (onDone = vi.fn()) => render(
    <PauseReminderPrompt providerId={76} providerName="Viaplay" resumeAt="2026-12-12" monthlyCost={129} onDone={onDone} />,
  );

  it('shows the approved text', () => {
    prompt();
    expect(screen.getByText('Viaplay pausad till 12 dec')).toBeInTheDocument();
    expect(screen.getByText('129 kr/mån')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Påminn mig 12 dec' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inte nu' })).toBeInTheDocument();
  });

  it('saves the reminder, and confirms only after the write', async () => {
    let resolve!: () => void;
    setPauseReminder.mockReturnValue(new Promise<void>(r => { resolve = r; }));
    const onDone = vi.fn();
    prompt(onDone);
    fireEvent.click(screen.getByRole('button', { name: 'Påminn mig 12 dec' }));
    expect(setPauseReminder).toHaveBeenCalledWith(76, true);
    expect(toast).not.toHaveBeenCalled();
    resolve();
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Binge påminner dig 12 dec'));
    expect(onDone).toHaveBeenCalled();
  });

  it('says so when the write fails, and stays', async () => {
    setPauseReminder.mockRejectedValue(new Error('Kunde inte spara.'));
    const onDone = vi.fn();
    prompt(onDone);
    fireEvent.click(screen.getByRole('button', { name: 'Påminn mig 12 dec' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Kunde inte spara.'));
    expect(onDone).not.toHaveBeenCalled();
  });

  it('"Inte nu" saves nothing', () => {
    const onDone = vi.fn();
    prompt(onDone);
    fireEvent.click(screen.getByRole('button', { name: 'Inte nu' }));
    expect(setPauseReminder).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });
});
