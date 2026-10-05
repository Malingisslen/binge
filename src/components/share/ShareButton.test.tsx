import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ShareButton from './ShareButton';

const toast = vi.hoisted(() => vi.fn());
const track = vi.hoisted(() => vi.fn());
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ show: toast }) }));
vi.mock('@/lib/analytics', () => ({ trackEvent: track }));

const PROPS = { path: '/movie/27205/', title: 'Inception', text: 'Se var Inception går att streama.', surface: 'title' as const };
const URL_OUT = `${window.location.origin}/movie/27205/?utm_source=share&utm_medium=title`;

const nav = navigator as unknown as { share?: unknown; clipboard?: unknown };

describe('ShareButton', () => {
  beforeEach(() => { toast.mockReset(); track.mockReset(); });
  afterEach(() => { delete nav.share; delete nav.clipboard; });

  it('öppnar telefonens delningsark med den märkta länken när Web Share finns', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    nav.share = share;
    render(<ShareButton {...PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: /dela/i }));
    await waitFor(() => expect(share).toHaveBeenCalledWith({ title: 'Inception', text: PROPS.text, url: URL_OUT }));
    expect(track).toHaveBeenCalledWith('share_clicked', { surface: 'title', method: 'native' });
    expect(toast).not.toHaveBeenCalled();
  });

  it('säger ingenting när delningsarket stängs utan att dela', async () => {
    nav.share = vi.fn().mockRejectedValue(new DOMException('cancel', 'AbortError'));
    render(<ShareButton {...PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: /dela/i }));
    await waitFor(() => expect(nav.share).toHaveBeenCalled());
    expect(toast).not.toHaveBeenCalled();
  });

  it('kopierar länken och säger till när Web Share saknas', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    nav.clipboard = { writeText };
    render(<ShareButton {...PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: /dela/i }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Länken är kopierad'));
    expect(writeText).toHaveBeenCalledWith(URL_OUT);
    expect(track).toHaveBeenCalledWith('share_clicked', { surface: 'title', method: 'copy' });
  });

  it('säger till när kopieringen nekas', async () => {
    nav.clipboard = { writeText: vi.fn().mockRejectedValue(new Error('denied')) };
    render(<ShareButton {...PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: /dela/i }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Kunde inte kopiera länken'));
  });
});
