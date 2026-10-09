'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users, Share2 } from 'lucide-react';
import AuthGuard from '@/components/AuthGuard';
import { useAuth } from '@/hooks/useAuth';
import { PageHeader } from '@/components/layout/PageHeader';
import { createSession, setSessionCandidates } from '@/lib/firebase/sessions';
import { generateCandidates, libraryExclusionIds } from '@/lib/together/candidates';
import { useWatchlist } from '@/hooks/useWatchlist';
import { SWEDISH_PROVIDERS } from '@/lib/tmdb/providers';
import { storeParticipantId } from '@/hooks/useSession';
import { FormSection, FormRadioGroup } from '@/components/ui/FormSection';
import { MAX_SESSION_DISPLAY_NAME } from '@/lib/clampText';
import { Button } from '@/components/ui/Button';
import { fieldClass } from '@/components/ui/Field';
import { cardClass } from '@/components/ui/Card';
import type {
  AggregationStrategy,
  ProviderMode,
  SessionMediaType,
  SessionConfig,
} from '@/types';

export default function NyTillsammansPage() {
  return <AuthGuard><NyContent /></AuthGuard>;
}

function NyContent() {
  const { user, uid } = useAuth();
  const { items: myLibrary } = useWatchlist();
  const router = useRouter();

  const [hostName, setHostName] = useState(user?.displayName ?? '');
  const [providers, setProviders] = useState<number[]>(user?.myProviders ?? []);
  const [mediaType, setMediaType] = useState<SessionMediaType>('both');
  const [providerMode, setProviderMode] = useState<ProviderMode>('intersect');
  const [aggregation, setAggregation] = useState<AggregationStrategy>('least_misery');
  const [maxRuntime, setMaxRuntime] = useState<string>('');
  const [allowAsymmetry, setAllowAsymmetry] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [providersError, setProvidersError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const providersRef = useRef<HTMLDivElement>(null);

  // The profile often arrives after the first render, so the useState seeds can
  // be empty. Seed once per field and never overwrite what the user has typed.
  const seeded = useRef({ name: !!user?.displayName, providers: (user?.myProviders?.length ?? 0) > 0 });
  useEffect(() => {
    if (!seeded.current.name && user?.displayName) {
      seeded.current.name = true;
      setHostName(prev => prev || (user.displayName ?? ''));
    }
    if (!seeded.current.providers && (user?.myProviders?.length ?? 0) > 0) {
      seeded.current.providers = true;
      setProviders(prev => prev.length > 0 ? prev : (user?.myProviders ?? []));
    }
  }, [user?.displayName, user?.myProviders]);

  const flatrate = SWEDISH_PROVIDERS.filter(p => p.type === 'flatrate');

  const toggleProvider = (id: number) => {
    setProviders(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    setProvidersError(null);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const name = hostName.trim();
    const missingName = !name;
    const missingProviders = providers.length === 0;
    setNameError(missingName ? 'Ange ett namn' : null);
    setProvidersError(missingProviders ? 'Välj minst en streamingtjänst' : null);
    if (missingName) { nameRef.current?.focus(); return; }
    if (missingProviders) {
      providersRef.current?.scrollIntoView({ block: 'center' });
      providersRef.current?.querySelector('input')?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const config: SessionConfig = {
        providerMode,
        aggregation,
        mediaType,
        maxRuntimeMin: maxRuntime ? parseInt(maxRuntime, 10) : null,
        allowAsymmetry,
      };
      const sessionId = await createSession({
        hostUid: uid,
        hostName: name,
        hostProviders: providers,
        config,
      });
      storeParticipantId(sessionId, uid ?? sessionId);
      // G4: föreslå inte titlar skaparen redan följer/sett/avbrutit.
      // Övriga deltagare ansluter via länk EFTER att kandidaterna genererats
      // (och deras watchlists är inte läsbara klient-sidigt), så bara
      // skaparens bibliotek kan exkluderas här.
      const candidates = await generateCandidates({
        config,
        providers,
        excludeTmdbIds: libraryExclusionIds(myLibrary),
      });
      await setSessionCandidates(sessionId, candidates);
      router.push(`/tillsammans/${sessionId}`);
    } catch (err) {
      console.error(err);
      setError('Kunde inte skapa session. Försök igen.');
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-[680px]">
      <PageHeader
        crumb="Tillsammans"
        title="Tillsammans ikväll"
        icon={<Users size={18} className="text-acc-deep" />}
        standfirst="Skapa en delad session. Alla röstar ja eller nej — bland titlar ni faktiskt kan streama just nu. Dela länken efter sessionen är skapad; de som får länken behöver inget konto."
      />

      <form onSubmit={onSubmit} className={cardClass()}>
        <FormSection title="Du">
          <label htmlFor="tillsammans-vardnamn" className="block text-xs text-ink-3 mb-1">Ditt namn</label>
          <input
            id="tillsammans-vardnamn"
            type="text"
            value={hostName}
            ref={nameRef}
            onChange={e => { setHostName(e.target.value); setNameError(null); }}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? 'tillsammans-namn-fel' : undefined}
            placeholder="T.ex. Lisa"
            maxLength={MAX_SESSION_DISPLAY_NAME}
            className={fieldClass({ className: 'w-full max-w-[260px]' })}
          />
          {nameError && <p id="tillsammans-namn-fel" role="alert" className="text-xs text-danger-ink mt-1">{nameError}</p>}
        </FormSection>

        <FormSection title="Dina streamingtjänster">
          <p className="text-xs text-ink-3 mb-2">Bara titlar från de här tjänsterna (plus deltagarnas, beroende på läge nedan) visas.</p>
          <div ref={providersRef} className="grid grid-cols-2 sm:grid-cols-3 gap-1">
            {flatrate.map(p => {
              const selected = providers.includes(p.id);
              return (
                <label
                  key={p.id}
                  className={`flex items-center gap-1.5 px-2 py-2 border rounded-sm cursor-pointer text-xs min-h-[40px] ${
                    selected ? 'border-acc-deep bg-acc-deep/[0.08]' : 'border-rule bg-surface'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleProvider(p.id)}
                    className="accent-acc-deep w-[12px] h-[12px]"
                  />
                  <span className="w-[6px] h-[6px] rounded-full" style={{ background: p.color }} />
                  {p.name}
                </label>
              );
            })}
          </div>
          {providersError && <p role="alert" className="text-xs text-danger-ink mt-1">{providersError}</p>}
        </FormSection>

        <FormSection title="Vad?">
          <FormRadioGroup
            name="mediaType"
            value={mediaType}
            onChange={v => setMediaType(v as SessionMediaType)}
            options={[
              { value: 'movie', label: 'Bara filmer' },
              { value: 'tv', label: 'Bara serier' },
              { value: 'both', label: 'Blandat' },
            ]}
          />
        </FormSection>

        <FormSection title="Tjänst-läge">
          <FormRadioGroup
            name="providerMode"
            value={providerMode}
            onChange={v => setProviderMode(v as ProviderMode)}
            options={[
              { value: 'intersect', label: 'Alla har', desc: 'Bara titlar alla deltagare kan streama' },
              { value: 'union', label: 'Någon har', desc: 'Inkluderar titlar som bara någon har' },
            ]}
          />
        </FormSection>

        <FormSection title="Hur en match väljs">
          <FormRadioGroup
            name="aggregation"
            value={aggregation}
            onChange={v => setAggregation(v as AggregationStrategy)}
            options={[
              { value: 'least_misery', label: 'Ingen hatar det', desc: 'Undvik titlar någon sagt nej till' },
              { value: 'average', label: 'Flest positiva', desc: 'Rankad efter antalet ja' },
              { value: 'fair', label: 'Turordning', desc: 'Var och en får prio i tur' },
            ]}
          />
        </FormSection>

        <FormSection title="Max längd (min)">
          <input
            type="number"
            value={maxRuntime}
            onChange={e => setMaxRuntime(e.target.value)}
            placeholder="T.ex. 120 (lämna tomt för ingen gräns)"
            min="30"
            max="400"
            className={fieldClass({ className: 'w-full max-w-[220px]' })}
          />
          <p className="text-xxs text-ink-3 mt-1">Gäller bara filmer.</p>
        </FormSection>

        {mediaType !== 'movie' && (
          <FormSection title="Serier i olika takt">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={allowAsymmetry}
                onChange={e => setAllowAsymmetry(e.target.checked)}
                className="accent-acc-deep w-[12px] h-[12px]"
              />
              Tillåt serier där ni ligger på olika avsnitt (varning visas)
            </label>
          </FormSection>
        )}

        {error && (
          <div className="px-3 py-2 text-xs text-danger-ink bg-danger-soft border-t border-danger/30">{error}</div>
        )}

        <div className="px-3 py-2 border-t border-rule-2 flex items-center gap-2">
          <Button
            type="submit"
            disabled={submitting}
            variant="acc" size="sm" className="disabled:opacity-50"
          >
            <Share2 size={11} className="inline mr-1" />
            {submitting ? 'Skapar…' : 'Skapa session och få länk'}
          </Button>
          <Button
            type="button"
            onClick={() => router.push('/')}
            variant="ghost" size="sm"
          >
            Avbryt
          </Button>
        </div>
      </form>
    </div>
  );
}

