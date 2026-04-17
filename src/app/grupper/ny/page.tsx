'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users } from 'lucide-react';
import AuthGuard from '@/components/AuthGuard';
import { FormSection, FormRadioGroup } from '@/components/ui/FormSection';
import { useAuth } from '@/hooks/useAuth';
import { createGroup } from '@/lib/firebase/groups';
import type {
  AggregationStrategy,
  GroupDefaults,
  ProviderMode,
  SessionMediaType,
} from '@/types';

export default function NyGruppPage() {
  return <AuthGuard><NyGruppContent /></AuthGuard>;
}

function NyGruppContent() {
  const { user, uid } = useAuth();
  const router = useRouter();

  const [name, setName] = useState('');
  const [providerMode, setProviderMode] = useState<ProviderMode>('intersect');
  const [aggregation, setAggregation] = useState<AggregationStrategy>('least_misery');
  const [mediaType, setMediaType] = useState<SessionMediaType>('both');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!uid || !user) { setError('Du måste vara inloggad.'); return; }
    const trimmed = name.trim();
    if (!trimmed) { setError('Ange ett gruppnamn.'); return; }

    setSubmitting(true);
    try {
      const defaults: GroupDefaults = { providerMode, aggregation, mediaType };
      const groupId = await createGroup({
        ownerUid: uid,
        ownerDisplayName: user.displayName,
        ownerUsername: user.username,
        ownerPhotoURL: user.photoURL,
        ownerProviders: user.myProviders,
        name: trimmed,
        defaults,
      });
      router.push(`/grupper/${groupId}`);
    } catch (err) {
      console.error(err);
      setError('Kunde inte skapa grupp. Försök igen.');
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-[680px]">
      <div className="flex items-center gap-2 mb-3">
        <Users size={18} className="text-accent" />
        <h1 className="text-[18px] font-bold text-text-primary">Ny grupp</h1>
      </div>
      <p className="text-xs text-text-muted mb-4 leading-relaxed">
        Skapa en permanent konstellation — bjud in via länk eller @handle. Era
        streamingtjänster och inställningar lever vidare mellan kvällar, så ni
        kan starta en ny session utan att ställa in allt på nytt.
      </p>

      <form onSubmit={onSubmit} className="bg-surface border border-border-main rounded-sm">
        <FormSection title="Gruppnamn">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="T.ex. Fredagsgänget, Familjen, Filmklubben"
            maxLength={48}
            className="w-full max-w-[360px] px-2 py-1 text-base border border-border-main rounded-sm bg-white"
          />
        </FormSection>

        <FormSection title="Default: vad?">
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

        <FormSection title="Default: provider-läge">
          <FormRadioGroup
            name="providerMode"
            value={providerMode}
            onChange={v => setProviderMode(v as ProviderMode)}
            options={[
              { value: 'intersect', label: 'Alla har (intersect)', desc: 'Bara titlar alla medlemmar kan streama' },
              { value: 'union', label: 'Någon har (union)', desc: 'Inkluderar titlar som bara någon har' },
            ]}
          />
        </FormSection>

        <FormSection title="Default: aggregering">
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

        <p className="px-3 py-2 text-xxs text-text-muted border-t border-border-light">
          Defaults används när du startar en ny session med gruppen — du kan
          alltid ändra per session.
        </p>

        {error && (
          <div className="px-3 py-2 text-xs text-red-700 bg-red-50 border-t border-red-200">{error}</div>
        )}

        <div className="px-3 py-2 border-t border-border-light flex items-center gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="px-3 py-[5px] bg-accent text-white border-none rounded-sm text-xs font-semibold cursor-pointer disabled:opacity-50"
          >
            {submitting ? 'Skapar...' : 'Skapa grupp'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/grupper')}
            className="px-3 py-[5px] border border-border-main rounded-sm text-xs bg-white cursor-pointer"
          >
            Avbryt
          </button>
        </div>
      </form>
    </div>
  );
}
