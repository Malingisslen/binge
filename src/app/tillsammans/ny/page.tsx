'use client';

import { useState } from 'react';
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

  const flatrate = SWEDISH_PROVIDERS.filter(p => p.type === 'flatrate');

  const toggleProvider = (id: number) => {
    setProviders(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const name = hostName.trim();
    if (!name) { setError('Ange ett namn'); return; }
    if (providers.length === 0) { setError('Välj minst en streamingtjänst'); return; }

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
        icon={<Users size={18} className="text-accent" />}
        standfirst="Skapa en delad session. Alla röstar ja eller nej — bland titlar ni faktiskt kan streama just nu. Dela länken efter sessionen är skapad; de som får länken behöver inget konto."
      />

      <form onSubmit={onSubmit} className="bg-surface border border-border-main rounded-sm">
        <FormSection title="Du">
          <label className="block text-xs text-text-muted mb-1">Ditt namn</label>
          <input
            type="text"
            value={hostName}
            onChange={e => setHostName(e.target.value)}
            placeholder="T.ex. Lisa"
            className="w-full max-w-[260px] px-2 py-1 text-base border border-border-main rounded-sm bg-white"
          />
        </FormSection>

        <FormSection title="Dina streamingtjänster">
          <p className="text-xs text-text-muted mb-2">Bara titlar från de här tjänsterna (plus deltagarnas, beroende på läge nedan) visas.</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-[3px]">
            {flatrate.map(p => {
              const selected = providers.includes(p.id);
              return (
                <label
                  key={p.id}
                  className={`flex items-center gap-[6px] px-2 py-[3px] border rounded-sm cursor-pointer text-xs ${
                    selected ? 'border-accent bg-accent/[0.08]' : 'border-border-main bg-white'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleProvider(p.id)}
                    className="accent-accent w-[12px] h-[12px]"
                  />
                  <span className="w-[6px] h-[6px] rounded-full" style={{ background: p.color }} />
                  {p.name}
                </label>
              );
            })}
          </div>
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

        <FormSection title="Aggregering vid match">
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
            className="w-full max-w-[220px] px-2 py-1 text-base border border-border-main rounded-sm bg-white"
          />
          <p className="text-xxs text-text-muted mt-1">Gäller bara filmer.</p>
        </FormSection>

        {mediaType !== 'movie' && (
          <FormSection title="Serier — asymmetri">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={allowAsymmetry}
                onChange={e => setAllowAsymmetry(e.target.checked)}
                className="accent-accent w-[12px] h-[12px]"
              />
              Tillåt serier med olika avsnittslägen (varning visas)
            </label>
          </FormSection>
        )}

        {error && (
          <div className="px-3 py-2 text-xs text-danger-ink bg-danger-soft border-t border-danger/30">{error}</div>
        )}

        <div className="px-3 py-2 border-t border-border-light flex items-center gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="px-3 py-[5px] bg-accent text-white border-none rounded-sm text-xs font-semibold cursor-pointer disabled:opacity-50"
          >
            <Share2 size={11} className="inline mr-1" />
            {submitting ? 'Skapar…' : 'Skapa session och få länk'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/')}
            className="px-3 py-[5px] border border-border-main rounded-sm text-xs bg-white cursor-pointer"
          >
            Avbryt
          </button>
        </div>
      </form>
    </div>
  );
}

