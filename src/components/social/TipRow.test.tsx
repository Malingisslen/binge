// Tipsa en vän — one tip in the Väntar på dig box. Mocked hooks: this pins the row's
// wording, its name lookup and its dismiss handling, not the rule.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TipRow } from './TipRow';
import type { Tip } from '@/lib/tips';

const dismissTip = vi.hoisted(() => vi.fn());
const sender = vi.hoisted(() => ({ value: null as { displayName: string | null; username: string | null } | null }));

vi.mock('@/hooks/useTips', () => ({ useTipActions: () => ({ dismissTip }) }));
vi.mock('@/hooks/useSenderProfile', () => ({ useSenderProfile: () => ({ data: sender.value }) }));

const TIP: Tip = {
  id: 'anna_tv_1399', fromUid: 'anna', mediaType: 'tv', tmdbId: 1399,
  title: 'Game of Thrones', note: 'Säsong 1 är bäst', createdAt: new Date(),
};

function renderRow(tip: Tip = TIP) {
  return render(<ul><TipRow tip={tip} /></ul>);
}

describe('TipRow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sender.value = { displayName: 'Anna', username: 'anna' };
  });

  // next/link drops the trailing slash in jsdom, so the href is matched with or without it.
  it('names the sender from their public card and links the title page', () => {
    renderRow();
    expect(screen.getByRole('link', { name: 'Anna' })).toHaveAttribute('href', expect.stringMatching(/^\/user\/anna\/?$/));
    expect(screen.getByRole('link', { name: 'Game of Thrones' })).toHaveAttribute('href', expect.stringMatching(/^\/tv\/1399\/?$/));
    expect(screen.getByText('Säsong 1 är bäst')).toBeInTheDocument();
  });

  it('falls back to a placeholder name when the card cannot be read', () => {
    sender.value = null;
    renderRow();
    expect(screen.getByText('Användare')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Användare' })).toBeNull();
  });

  it('does not add a poster-less title to the library from the row', () => {
    renderRow();
    expect(screen.queryByRole('button', { name: /följ|spara|lägg till/i })).toBeNull();
  });

  it('dismisses the tip by its id', async () => {
    dismissTip.mockResolvedValue(undefined);
    renderRow();
    fireEvent.click(screen.getByRole('button', { name: 'Ta bort' }));
    await waitFor(() => expect(dismissTip).toHaveBeenCalledWith('anna_tv_1399'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says so when the dismiss fails', async () => {
    dismissTip.mockRejectedValue(new Error('offline'));
    renderRow();
    fireEvent.click(screen.getByRole('button', { name: 'Ta bort' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Gick inte att ta bort');
  });
});
