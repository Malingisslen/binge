'use client';

import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { trackEvent } from '@/lib/analytics';
import { scorePassword } from '@/lib/passwordStrength';
import { PasswordStrengthMeter } from '@/components/auth/PasswordStrengthMeter';
import { CURRENT_TERMS_VERSION, MIN_AGE } from '@/lib/legal';

export default function LoginPage() {
  const { user, signIn, signInEmail, register, loading } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user) return;
    // Nya användare utan myProviders + utan onboardingCompletedAt ska igenom
    // onboarding-flödet. Existerande användare (före featuren landade) har
    // varken flagga men har providers — vi skickar bara in tomma profiler.
    const needsOnboarding =
      !user.onboardingCompletedAt && (user.myProviders?.length ?? 0) === 0;
    router.push(needsOnboarding ? '/onboarding/' : '/');
  }, [user, router]);

  async function handleGoogle() {
    setError('');
    try {
      await signIn();
      trackEvent('signed_in', { method: 'google' });
    } catch (err) {
      console.error('Google sign-in failed:', err);
      setError('Inloggningen misslyckades. Försök igen om en stund.');
    }
  }

  // Inline-anrop — scorePassword är O(length) med några regex, inget värt att memo:a.
  const passwordStrength = mode === 'register' ? scorePassword(password) : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (mode === 'register') {
        if (!name.trim()) { setError('Ange ditt namn.'); setSubmitting(false); return; }
        if (!ageConfirmed) { setError('Du måste vara minst 13 år för att skapa konto.'); setSubmitting(false); return; }
        if (!termsAccepted) { setError('Du måste godkänna villkoren för att skapa konto.'); setSubmitting(false); return; }
        if (passwordStrength && !passwordStrength.acceptable) {
          setError(passwordStrength.feedback || 'Lösenordet är för svagt.');
          setSubmitting(false);
          return;
        }
        await register(email, password, name, CURRENT_TERMS_VERSION);
        trackEvent('signed_up');
      } else {
        await signInEmail(email, password);
        trackEvent('signed_in', { method: 'email' });
      }
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? '';
      if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setError('Fel e-post eller lösenord.');
      } else if (code === 'auth/email-already-in-use') {
        setError('E-postadressen används redan.');
      } else if (code === 'auth/weak-password') {
        setError('Lösenordet måste vara minst 6 tecken.');
      } else if (mode === 'register') {
        setError('Kunde inte skapa kontot. Kontrollera anslutningen och försök igen.');
      } else {
        setError('Inloggningen misslyckades. Kontrollera anslutningen och försök igen.');
      }
    }
    setSubmitting(false);
  }

  const registerDisabled = submitting
    || (mode === 'register' && (!ageConfirmed || !termsAccepted));

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="bg-surface border border-rule rounded-sm px-8 py-6 max-w-[340px] w-full">
        <div className="text-center mb-4">
          <div className="text-[20px] font-extrabold text-acc-deep">
            binge<span className="font-normal text-ink-3 text-sm">.nu</span>
          </div>
          <p className="text-sm text-ink-3 mt-1">
            Håll koll på vad du tittar på och var det finns att streama i Sverige.
          </p>
        </div>

        <button
          onClick={handleGoogle}
          disabled={loading}
          className="w-full px-4 py-2 bg-acc-deep text-white border-none rounded-sm cursor-pointer font-[inherit] text-base font-semibold hover:opacity-90 disabled:opacity-50 mb-2"
        >
          Logga in med Google
        </button>

        {/* BIN-275/348: browse-wrap consent + 13+ age notice at the Google entry
            point. Continuing past this records terms acceptance + age confirmation
            at account creation (AuthContext.ensureUserProfile). */}
        <p className="text-xxs text-ink-3 text-center leading-snug mb-3">
          Genom att fortsätta godkänner du Binges{' '}
          <Link href="/villkor" target="_blank" className="text-acc-deep underline">användarvillkor</Link>
          {' '}och{' '}
          <Link href="/integritet" target="_blank" className="text-acc-deep underline">integritetspolicy</Link>
          {' '}och intygar att du är minst {MIN_AGE} år.
        </p>

        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 h-px bg-rule" />
          <span className="text-xxs text-ink-3">eller</span>
          <div className="flex-1 h-px bg-rule" />
        </div>

        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <input
              type="text"
              placeholder="Namn"
              aria-label="Namn"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-2 py-[6px] mb-2 text-base border border-rule rounded-sm bg-white font-[inherit] outline-none focus:border-acc-deep"
            />
          )}
          <input
            type="email"
            placeholder="E-post"
            aria-label="E-post"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            className="w-full px-2 py-[6px] mb-2 text-base border border-rule rounded-sm bg-white font-[inherit] outline-none focus:border-acc-deep"
          />
          <input
            type="password"
            placeholder="Lösenord"
            aria-label="Lösenord"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={mode === 'register' ? 8 : 6}
            className="w-full px-2 py-[6px] mb-2 text-base border border-rule rounded-sm bg-white font-[inherit] outline-none focus:border-acc-deep"
          />
          {mode === 'register' && passwordStrength && (
            <PasswordStrengthMeter strength={passwordStrength} />
          )}
          {mode === 'register' && (
            <div className="mt-3 mb-2 space-y-2 text-xs text-ink-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ageConfirmed}
                  onChange={e => setAgeConfirmed(e.target.checked)}
                  className="mt-[2px] cursor-pointer"
                />
                <span>Jag är minst {MIN_AGE} år gammal.</span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={e => setTermsAccepted(e.target.checked)}
                  className="mt-[2px] cursor-pointer"
                />
                <span>
                  Jag godkänner Binges{' '}
                  <Link href="/villkor" target="_blank" className="text-acc-deep underline">användarvillkor</Link>
                  {' '}och{' '}
                  <Link href="/integritet" target="_blank" className="text-acc-deep underline">integritetspolicy</Link>.
                </span>
              </label>
            </div>
          )}
          {error && <div className="text-xs text-danger-ink mb-2">{error}</div>}
          <button
            type="submit"
            disabled={registerDisabled}
            className="w-full px-4 py-[6px] bg-ink text-white border-none rounded-sm cursor-pointer font-[inherit] text-base font-semibold hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? (mode === 'register' ? 'Skapar…' : 'Loggar in…') : mode === 'register' ? 'Skapa konto' : 'Logga in'}
          </button>
        </form>

        <div className="text-center mt-3">
          <button
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
            className="text-xs text-acc-deep bg-transparent border-none cursor-pointer font-[inherit]"
          >
            {mode === 'login' ? 'Har du inget konto? Skapa ett' : 'Har du redan konto? Logga in'}
          </button>
        </div>
      </div>
    </div>
  );
}
