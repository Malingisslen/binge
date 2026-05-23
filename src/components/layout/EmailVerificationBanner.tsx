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
      className="bg-accent/[0.08] border-b border-accent/30 px-3 py-[5px] text-xs text-text-secondary flex items-center gap-3 flex-wrap"
    >
      <span>
        Bekräfta din e-postadress för att slutföra registreringen.
      </span>
      <button
        onClick={resend}
        disabled={sending}
        className="text-xs text-accent bg-transparent border-none cursor-pointer font-semibold disabled:opacity-50 underline"
      >
        {sending ? 'Skickar…' : 'Skicka igen'}
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="ml-auto text-xxs text-text-muted bg-transparent border-none cursor-pointer"
        aria-label="Stäng"
      >
        Dölj
      </button>
    </div>
  );
}
