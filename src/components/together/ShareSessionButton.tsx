'use client';

import { useEffect, useState } from 'react';
import { Share2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/** Native share sheet for the session link. Renders nothing where the browser has no share API. */
export function ShareSessionButton({ url }: { url: string }) {
  // Decided after mount so server and client markup agree.
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    setSupported(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  if (!supported || !url) return null;

  const share = async () => {
    try {
      await navigator.share({ title: 'Tillsammans', text: 'Välj film tillsammans med mig.', url });
    } catch {/* the person closed the sheet */}
  };

  return (
    <Button type="button" onClick={share} variant="ghost" size="xs" className="flex items-center gap-1 min-h-11">
      <Share2 size={10} aria-hidden="true" />
      Dela
    </Button>
  );
}
