'use client';

import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function LoginPage() {
  const { user, signIn, signInEmail, register, loading } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user) router.push('/');
  }, [user, router]);

  async function handleGoogle() {
    setError('');
    try { await signIn(); } catch (err) {
      console.error('Google sign-in failed:', err);
      setError('Inloggning misslyckades.');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (mode === 'register') {
        if (!name.trim()) { setError('Ange ditt namn.'); setSubmitting(false); return; }
        await register(email, password, name);
      } else {
        await signInEmail(email, password);
      }
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? '';
      if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setError('Fel e-post eller lösenord.');
      } else if (code === 'auth/email-already-in-use') {
        setError('E-postadressen används redan.');
      } else if (code === 'auth/weak-password') {
        setError('Lösenordet måste vara minst 6 tecken.');
      } else {
        setError('Något gick fel. Försök igen.');
      }
    }
    setSubmitting(false);
  }

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="bg-surface border border-border-main rounded-sm px-8 py-6 max-w-[340px] w-full">
        <div className="text-center mb-4">
          <div className="text-[20px] font-extrabold text-accent">
            binge<span className="font-normal text-text-muted text-sm">.nu</span>
          </div>
          <p className="text-sm text-text-muted mt-1">
            Håll koll på vad du tittar på och var det finns att streama i Sverige.
          </p>
        </div>

        <button
          onClick={handleGoogle}
          disabled={loading}
          className="w-full px-4 py-2 bg-accent text-white border-none rounded-sm cursor-pointer font-[inherit] text-base font-semibold hover:opacity-90 disabled:opacity-50 mb-3"
        >
          Logga in med Google
        </button>

        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 h-px bg-border-main" />
          <span className="text-xxs text-text-muted">eller</span>
          <div className="flex-1 h-px bg-border-main" />
        </div>

        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <input
              type="text"
              placeholder="Namn"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-2 py-[6px] mb-2 text-base border border-border-main rounded-sm bg-white font-[inherit] outline-none focus:border-accent"
            />
          )}
          <input
            type="email"
            placeholder="E-post"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            className="w-full px-2 py-[6px] mb-2 text-base border border-border-main rounded-sm bg-white font-[inherit] outline-none focus:border-accent"
          />
          <input
            type="password"
            placeholder="Lösenord"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={6}
            className="w-full px-2 py-[6px] mb-2 text-base border border-border-main rounded-sm bg-white font-[inherit] outline-none focus:border-accent"
          />
          {error && <div className="text-xs text-red-600 mb-2">{error}</div>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full px-4 py-[6px] bg-text-primary text-white border-none rounded-sm cursor-pointer font-[inherit] text-base font-semibold hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? '...' : mode === 'register' ? 'Skapa konto' : 'Logga in'}
          </button>
        </form>

        <div className="text-center mt-3">
          <button
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
            className="text-xs text-accent bg-transparent border-none cursor-pointer font-[inherit]"
          >
            {mode === 'login' ? 'Har du inget konto? Skapa ett' : 'Har du redan konto? Logga in'}
          </button>
        </div>
      </div>
    </div>
  );
}
