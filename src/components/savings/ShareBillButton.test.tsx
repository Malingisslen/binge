import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ShareBillButton, { billImageContent } from './ShareBillButton';
import { previousMonth, type MonthlyBill } from '@/lib/advisor/monthlyBill';

const toast = vi.hoisted(() => vi.fn());
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ show: toast }) }));

// Viaplay 76, Netflix 8, Disney+ 337.
const BILL: MonthlyBill = {
  month: previousMonth(new Date('2026-10-07T08:00:00')),
  lines: [
    { providerId: 76, costKr: 449, pausedWholeMonth: false, episodes: 1, films: 0, krPerItem: 449 },
    { providerId: 8, costKr: 169, pausedWholeMonth: false, episodes: 4, films: 0, krPerItem: 42 },
    { providerId: 337, costKr: 0, pausedWholeMonth: true, episodes: 0, films: 0, krPerItem: null },
  ],
  totalKr: 618, episodes: 5, films: 0, krPerItem: 124,
};

const nav = navigator as unknown as { share?: unknown; canShare?: unknown };
const drawn: string[] = [];

describe('ShareBillButton', () => {
  beforeEach(() => {
    toast.mockReset();
    drawn.length = 0;
    const ctx = new Proxy({}, {
      get: (_t, key) => key === 'fillText' ? (s: string) => { drawn.push(s); } : () => undefined,
      set: () => true,
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(cb => cb(new Blob(['png'], { type: 'image/png' })));
  });
  afterEach(() => { delete nav.share; delete nav.canShare; vi.restoreAllMocks(); });

  async function ready() {
    const button = screen.getByRole('button', { name: 'Dela notan' });
    await waitFor(() => expect(button).toBeEnabled());
    return button;
  }
  function stubDownload() {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    return vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  }

  it('hands the drawn image and the approved line to the share sheet', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    nav.share = share;
    nav.canShare = () => true;
    render(<ShareBillButton bill={BILL} />);
    fireEvent.click(await ready());
    expect(share).toHaveBeenCalledTimes(1);
    const arg = share.mock.calls[0][0] as { files: File[]; text: string };
    expect(arg.text).toBe('Min streaming i september: 618 kr. Räkna på din egen på binge.nu');
    expect(arg.files[0].type).toBe('image/png');
    expect(drawn).toContain('Min streaming i september');
    expect(drawn).toContain('449 kr för ett avsnitt');
    expect(toast).not.toHaveBeenCalled();
  });

  it('says nothing when the share sheet is closed without sharing', async () => {
    nav.share = vi.fn().mockRejectedValue(new DOMException('cancel', 'AbortError'));
    nav.canShare = () => true;
    const click = stubDownload();
    render(<ShareBillButton bill={BILL} />);
    fireEvent.click(await ready());
    await waitFor(() => expect(nav.share).toHaveBeenCalled());
    await Promise.resolve();
    expect(toast).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it('saves the image instead when the share sheet refuses for any other reason', async () => {
    nav.share = vi.fn().mockRejectedValue(new DOMException('no tap', 'NotAllowedError'));
    nav.canShare = () => true;
    const click = stubDownload();
    render(<ShareBillButton bill={BILL} />);
    fireEvent.click(await ready());
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Bilden är sparad'));
    expect(click).toHaveBeenCalled();
  });

  it('saves the image when the browser cannot share files', async () => {
    nav.share = vi.fn();
    nav.canShare = () => false;
    const click = stubDownload();
    render(<ShareBillButton bill={BILL} />);
    fireEvent.click(await ready());
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Bilden är sparad'));
    expect(click).toHaveBeenCalled();
    expect(nav.share).not.toHaveBeenCalled();
  });
});

describe('billImageContent', () => {
  it('names services and prices only, and leaves the paused one off', () => {
    expect(billImageContent(BILL)).toEqual({
      monthName: 'september',
      totalKr: 618,
      rows: [
        { name: 'Viaplay', text: '449 kr för ett avsnitt' },
        { name: 'Netflix', text: '42 kr per avsnitt' },
      ],
    });
  });
});
