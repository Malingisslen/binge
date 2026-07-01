'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/contexts/ToastContext';

/**
 * Banner som visas för inloggade email-användare som inte verifierat.
 * Google-SSO-användare räknas alltid som verifierade (emailVerified=true
 * via Firebase) så bannern försvinner för dem.
 *
 * Banner är icke-blockerande — ingen feature är gated idag, vi bara nudgar.
 * Om abuse blir ett problem kan vi senare gate:a review-posting eller
 * follow-skrivning bakom emailVerified.
 */
export function EmailVerificationBanner() {
  const { user, emailVerified, resendEmailVerification } = useAuth();
  const { show: toast } = useToast();
  const [sending, setSending] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (!user || emailVerified || dismissed) return null;

  const resend = async () => {
    setSending(true);
    try {
      await resendEmailVerification();
      toast('Verifieringsmail skickat. Kolla din inkorg.');
    } catch (err) {

      console.error('[resend-verification]', err);
      toast('Kunde inte skicka mailet. Försök igen om en stund.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      role="status"
      className="bg-acc-deep/[0.08] border-b border-acc-deep/30 px-3 py-[5px] text-xs text-ink-2 flex items-center gap-3 flex-wrap"
    >
      <span>
        Bekräfta din e-postadress.
      </span>
      <button
        onClick={resend}
        disabled={sending}
        className="text-xs text-acc-deep bg-transparent border-none cursor-pointer font-semibold disabled:opacity-50 underline"
      >
        {sending ? 'Skickar…' : 'Skicka igen'}
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="ml-auto text-xxs text-ink-3 bg-transparent border-none cursor-pointer"
        aria-label="Stäng"
      >
        Dölj
      </button>
    </div>
  );
}
