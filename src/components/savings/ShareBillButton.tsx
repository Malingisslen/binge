'use client';

import { useEffect, useRef, useState } from 'react';
import { Share2 } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { Button } from '@/components/ui/Button';
import { getProvider } from '@/lib/tmdb/providers';
import { billShareRowText, billShareText, type MonthlyBill } from '@/lib/advisor/monthlyBill';
import {
  BILL_IMAGE_HEIGHT, BILL_IMAGE_WIDTH, billImageFonts, drawBillImage,
  type BillImageColors, type BillImageContent,
} from '@/lib/advisor/monthlyBillImage';

export function billImageContent(bill: MonthlyBill): BillImageContent {
  const rows = bill.lines.flatMap(line => {
    const text = billShareRowText(line);
    if (text == null) return [];
    return [{ name: getProvider(line.providerId)?.shortName ?? String(line.providerId), text }];
  });
  return { monthName: bill.month.name, rows, totalKr: bill.totalKr };
}

// The saffron of the light theme, read from the stylesheet so the image looks the
// same in dark mode (sketch: "ser likadan ut oavsett om du har ljust eller mörkt läge").
// next/font registers Albert Sans under a generated family name, exposed as --font-sans.
function imageStyle(): BillImageColors {
  const probe = document.createElement('div');
  probe.setAttribute('data-theme', 'light');
  probe.hidden = true;
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const family = getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim();
  const result = {
    background: style.getPropertyValue('--acc-deep').trim(),
    ink: style.getPropertyValue('--on-acc').trim(),
    fontFamily: `${family ? `${family}, ` : ''}system-ui, -apple-system, "Segoe UI", sans-serif`,
  };
  probe.remove();
  return result;
}

async function renderBillImage(content: BillImageContent): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = BILL_IMAGE_WIDTH;
  canvas.height = BILL_IMAGE_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const style = imageStyle();
  // fonts.ready only waits for fonts already requested; the canvas has to ask itself.
  await Promise.all(billImageFonts(style.fontFamily).map(f => document.fonts?.load(f).catch(() => undefined)));
  drawBillImage(ctx, content, style);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

function saveFile(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking at once cancels the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * "Dela notan": the phone's share sheet with the image where it can take files,
 * otherwise the image is saved. A closed share sheet is not an error.
 */
export default function ShareBillButton({ bill }: { bill: MonthlyBill }) {
  const { show: toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const sharing = useRef(false);

  // Drawn before the tap: Safari only opens the share sheet when share() is called
  // in the tap itself, and drawing awaits fonts and toBlob.
  useEffect(() => {
    let live = true;
    setFile(null);
    renderBillImage(billImageContent(bill)).then(
      blob => { if (live && blob) setFile(new File([blob], `binge-${bill.month.name}.png`, { type: 'image/png' })); },
      () => undefined,
    );
    return () => { live = false; };
  }, [bill]);

  async function handleClick() {
    if (!file || sharing.current) return;
    if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
      sharing.current = true;
      try {
        await navigator.share({ files: [file], text: billShareText(bill) });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      } finally {
        sharing.current = false;
      }
    }
    saveFile(file);
    toast('Bilden är sparad');
  }

  return (
    <Button type="button" onClick={handleClick} disabled={!file} variant="ghost" size="sm" className="inline-flex items-center gap-1 shrink-0">
      <Share2 size={11} aria-hidden="true" /> Dela notan
    </Button>
  );
}
