'use client';

import { Share2 } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { trackEvent } from '@/lib/analytics';
import { shareLink, type ShareSurface } from '@/lib/shareLink';
import { Button } from '@/components/ui/Button';

interface ShareButtonProps {
  /** Sidans sökväg, t.ex. `/movie/27205/`. Originet läses från fönstret vid klick. */
  path: string;
  /** Rubriken i telefonens delningsark. */
  title: string;
  /** Raden ovanför länken i delningsarket. */
  text?: string;
  surface: ShareSurface;
}

/**
 * Telefonens eget delningsark där det finns (Web Share), annars kopieras länken.
 * Ett avbrutet delningsark är inget fel och ger ingen toast.
 */
export default function ShareButton({ path, title, text, surface }: ShareButtonProps) {
  const { show: toast } = useToast();

  async function handleClick() {
    const url = shareLink(window.location.origin, path, surface);
    if (typeof navigator.share === 'function') {
      trackEvent('share_clicked', { surface, method: 'native' });
      try {
        await navigator.share({ title, text, url });
      } catch {
        // AbortError när arket stängs; inget att säga till om.
      }
      return;
    }
    trackEvent('share_clicked', { surface, method: 'copy' });
    try {
      await navigator.clipboard.writeText(url);
      toast('Länken är kopierad');
    } catch {
      toast('Kunde inte kopiera länken');
    }
  }

  return (
    <Button
      type="button"
      onClick={handleClick}
      variant="ghost" size="sm" className="inline-flex items-center gap-[5px]"
    >
      <Share2 size={11} aria-hidden="true" /> Dela
    </Button>
  );
}
