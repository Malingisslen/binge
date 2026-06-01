'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, ArrowLeft, Check, Search, Target } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useSearch } from '@/hooks/useTMDB';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { SWEDISH_PROVIDERS } from '@/lib/tmdb/providers';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { trackEvent } from '@/lib/analytics';
import { posterUrl, getDisplayTitle, getReleaseYear, isAddableMediaType } from '@/lib/tmdb/client';
import { toneForGenreIds, toneForId } from '@/lib/duotone';
import type { TMDBSearchResult, WatchStatus } from '@/types';

/**
 * Onboarding-flöde för nya användare. 4 steg:
 *
 * 1. Välkommen + value prop
 * 2. Välj streamingtjänster (defaultar till de största svenska)
 * 3. Lägg till första titeln (med förslag + sök)
 * 4. Valfri /kalibrera + klar-skärm
 *
 * State hålls i ett enkelt step-index. Vi persisterar inte mid-flow — om
 * användaren laddar om får de börja från början. Enkelt och OK för v1.
 *
 * "Skippa"-knappen är alltid tillgänglig — vi låser inte någon funktionalitet
 * bakom onboarding-completion, bara routar nya användare hit vid första
 * inloggning.
 */

const DEFAULT_PROVIDERS = [8, 119, 337, 384, 76, 520]; // Netflix, Prime, Disney+, HBO Max, Viaplay, SVT Play

export function OnboardingFlow() {
  const router = useRouter();
  const { uid, user } = useAuth();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [saving, setSaving] = useState(false);

  if (!uid || !user) return null;

  const finish = async () => {
    setSaving(true);
    try {
      await setDoc(
        doc(db, 'users', uid),
        { onboardingCompletedAt: serverTimestamp() },
        { merge: true },
      );
      trackEvent('onboarding_completed', { step_reached: step });
      router.push('/');
    } finally {
      setSaving(false);
    }
  };

  const skip = async () => {
    // Markera som klar även vid skip så vi inte bombarderar igen.
    await finish();
  };

  return (
    <div className="max-w-[640px] mx-auto py-8 px-4">
      <StepIndicator current={step} total={4} />
      <div className="mt-6 bg-surface border border-border-main rounded-sm p-6">
        {step === 1 && <StepWelcome onNext={() => setStep(2)} />}
        {step === 2 && <StepProviders onBack={() => setStep(1)} onNext={() => setStep(3)} />}
        {step === 3 && <StepFirstTitle onBack={() => setStep(2)} onNext={() => setStep(4)} />}
        {step === 4 && <StepDone onBack={() => setStep(3)} onFinish={finish} saving={saving} />}
      </div>
      <div className="mt-4 text-center">
        <button
          onClick={skip}
          disabled={saving}
          className="text-xxs text-text-muted hover:text-text-secondary bg-transparent border-none cursor-pointer disabled:opacity-50"
        >
          Hoppa över
        </button>
      </div>
    </div>
  );
}

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-[3px] flex-1 rounded-sm ${
            i + 1 <= current ? 'bg-accent' : 'bg-border-light'
          }`}
        />
      ))}
    </div>
  );
}

// ---- Step 1: Välkommen ----

function StepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div>
      <h1 className="page-h1" style={{ marginBottom: 12 }}>
        Välkommen till Binge.nu
      </h1>
      <p className="text-sm text-text-secondary mb-4">
        Håll koll på vad du tittar på och se var filmer och serier streamas i
        Sverige. Tre steg.
      </p>
      <ul className="space-y-2 mb-6 text-sm text-text-secondary">
        <li className="flex items-start gap-2">
          <Check size={14} className="text-accent mt-[3px] shrink-0" />
          <span>Välj vilka streamingtjänster du har</span>
        </li>
        <li className="flex items-start gap-2">
          <Check size={14} className="text-accent mt-[3px] shrink-0" />
          <span>Lägg till något du vill se eller redan följer</span>
        </li>
        <li className="flex items-start gap-2">
          <Check size={14} className="text-accent mt-[3px] shrink-0" />
          <span>Få rekommendationer baserat på din smak</span>
        </li>
      </ul>
      <button
        onClick={onNext}
        className="inline-flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-sm text-sm font-semibold cursor-pointer"
      >
        Börja <ArrowRight size={14} />
      </button>
    </div>
  );
}

// ---- Step 2: Providers ----

function StepProviders({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const { user, updateProviders } = useAuth();
  const [selected, setSelected] = useState<number[]>(
    user?.myProviders && user.myProviders.length > 0
      ? user.myProviders
      : DEFAULT_PROVIDERS,
  );
  const [saving, setSaving] = useState(false);

  const toggle = (id: number) =>
    setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));

  const flatrateProviders = SWEDISH_PROVIDERS.filter(p => p.type === 'flatrate');

  const save = async () => {
    setSaving(true);
    try {
      await updateProviders(selected);
      onNext();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h1 className="page-h1" style={{ marginBottom: 12 }}>
        Vilka tjänster har du?
      </h1>
      <p className="text-sm text-text-secondary mb-4">
        Används för att visa var dina titlar kan streamas — och för att räkna
        ut om du kan pausa någon tjänst. Kryssa alla du prenumererar på.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-6">
        {flatrateProviders.map(p => {
          const isSelected = selected.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => toggle(p.id)}
              className={`flex items-center gap-2 px-3 py-2 border rounded-sm cursor-pointer text-left ${
                isSelected
                  ? 'border-accent bg-accent/[0.05] text-text-primary'
                  : 'border-border-main bg-white text-text-secondary'
              }`}
            >
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ background: p.color }}
              />
              <span className="text-sm flex-1 truncate">{p.shortName}</span>
              {isSelected && <Check size={12} className="text-accent shrink-0" />}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 px-3 py-2 border border-border-main rounded-sm text-sm bg-white cursor-pointer"
        >
          <ArrowLeft size={14} /> Tillbaka
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-sm text-sm font-semibold cursor-pointer disabled:opacity-50"
        >
          {saving ? 'Sparar…' : 'Nästa'} <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ---- Step 3: Första titeln ----

function StepFirstTitle({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 250);
  const { data: searchData, isLoading } = useSearch(debouncedQuery);
  const { items, addItem } = useWatchlist();

  const canContinue = items.length > 0;

  // intent='plan' → vill_se. intent='engage' → mina (TV) eller sedd (film).
  // Onboarding-knapparna heter "Vill se" och "Följer/Sett" beroende på mediaType.
  const handleAdd = async (
    result: TMDBSearchResult & { media_type: 'movie' | 'tv' },
    intent: 'plan' | 'engage',
  ) => {
    const title = getDisplayTitle(result);
    const status: WatchStatus = intent === 'plan'
      ? 'vill_se'
      : (result.media_type === 'tv' ? 'mina' : 'sedd');
    await addItem({
      tmdbId: result.id,
      mediaType: result.media_type,
      status,
      title,
      posterPath: result.poster_path,
      releaseYear: getReleaseYear(result),
      totalSeasons: null,
      lastWatchedSeason: null,
      lastWatchedEpisode: null,
      rating: null,
      notes: null,
      providers: [],
      genreIds: result.genre_ids ?? [],
      tmdbStatus: null,
    });
  };

  return (
    <div>
      <h1 className="page-h1" style={{ marginBottom: 12 }}>
        Lägg till din första titel
      </h1>
      <p className="text-sm text-text-secondary mb-4">
        Sök efter en film eller serie och välj om du vill se den eller följer
        den.
      </p>
      <div className="flex items-center gap-2 mb-3 border border-border-main rounded-sm bg-white px-2">
        <Search size={13} className="text-text-muted" />
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="T.ex. Breaking Bad, Parasite, Succession…"
          className="flex-1 py-2 text-sm border-none outline-none font-[inherit] bg-transparent"
          autoFocus
        />
      </div>

      {isLoading && query.length >= 2 && (
        <div className="text-xs text-text-muted py-2">Söker…</div>
      )}

      {searchData && searchData.results.length > 0 && (
        <ul className="space-y-1 mb-4 max-h-[280px] overflow-y-auto">
          {searchData.results
            .filter(isAddableMediaType)
            .slice(0, 6)
            .map(r => {
              const alreadyAdded = items.some(i => i.tmdbId === r.id);
              const poster = posterUrl(r.poster_path, 'w92');
              return (
                <li
                  key={r.id}
                  className="flex items-center gap-2 px-2 py-[5px] bg-white border border-border-main rounded-sm"
                >
                  {poster && (
                    <div className={`poster duo-${r.genre_ids?.length ? toneForGenreIds(r.genre_ids) : toneForId(r.id)} w-[28px] h-[42px] shrink-0`}>
                      <img
                        src={poster}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        width={28}
                        height={42}
                      />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-text-primary truncate">
                      {getDisplayTitle(r)}
                    </div>
                    <div className="text-xxs text-text-muted">
                      {r.media_type === 'movie' ? 'Film' : 'Serie'}
                      {getReleaseYear(r) ? ` · ${getReleaseYear(r)}` : ''}
                    </div>
                  </div>
                  {alreadyAdded ? (
                    <span className="text-xxs text-accent inline-flex items-center gap-1">
                      <Check size={11} /> Tillagd
                    </span>
                  ) : (
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleAdd(r, 'plan')}
                        className="text-xxs px-2 py-[3px] border border-border-main rounded-sm bg-white cursor-pointer"
                      >
                        Vill se
                      </button>
                      <button
                        onClick={() => handleAdd(r, 'engage')}
                        className="text-xxs px-2 py-[3px] bg-accent text-white rounded-sm cursor-pointer"
                      >
                        {r.media_type === 'tv' ? 'Följer' : 'Sedd'}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
        </ul>
      )}

      {items.length > 0 && (
        <div className="text-xs text-accent mb-3">
          <Check size={11} className="inline mb-[2px] mr-1" />
          {items.length} titel{items.length === 1 ? '' : 'ar'} tillagd{items.length === 1 ? '' : 'a'}.
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 px-3 py-2 border border-border-main rounded-sm text-sm bg-white cursor-pointer"
        >
          <ArrowLeft size={14} /> Tillbaka
        </button>
        <button
          onClick={onNext}
          disabled={!canContinue}
          className="inline-flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-sm text-sm font-semibold cursor-pointer disabled:opacity-50"
        >
          Nästa <ArrowRight size={14} />
        </button>
        {!canContinue && (
          <button
            onClick={onNext}
            className="text-xxs text-text-muted hover:text-text-secondary bg-transparent border-none cursor-pointer ml-auto"
          >
            Hoppa över
          </button>
        )}
      </div>
    </div>
  );
}

// ---- Step 4: Klar / kalibrera ----

function StepDone({
  onBack,
  onFinish,
  saving,
}: {
  onBack: () => void;
  onFinish: () => Promise<void>;
  saving: boolean;
}) {
  return (
    <div>
      <h1 className="page-h1" style={{ marginBottom: 12 }}>
        Klar.
      </h1>
      <p className="text-sm text-text-secondary mb-4">
        Lägg till fler titlar, utforska rekommendationer eller se var dina
        serier streamas.
      </p>

      <div className="bg-accent/[0.06] border border-accent/30 rounded-sm p-3 mb-4">
        <div className="flex items-start gap-2 mb-2">
          <Target size={14} className="text-accent mt-[2px] shrink-0" />
          <div className="flex-1">
            <div className="text-sm font-bold text-text-primary">
              Kalibrera smaken
            </div>
            <p className="text-xxs text-text-muted mt-1">
              Ranka 10 genrer du gillar så blir rekommendationerna skarpare.
              Cirka 2 minuter — kan göras senare från inställningarna.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            href="/kalibrera/"
            className="inline-flex items-center gap-1 px-3 py-[5px] bg-accent text-white rounded-sm text-xs font-semibold cursor-pointer no-underline"
          >
            <Target size={11} /> Kalibrera smak
          </Link>
          <button
            onClick={onFinish}
            disabled={saving}
            className="px-3 py-[5px] border border-border-main rounded-sm text-xs bg-white cursor-pointer disabled:opacity-50"
          >
            Senare
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          disabled={saving}
          className="inline-flex items-center gap-1 px-3 py-2 border border-border-main rounded-sm text-sm bg-white cursor-pointer disabled:opacity-50"
        >
          <ArrowLeft size={14} /> Tillbaka
        </button>
        <button
          onClick={onFinish}
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-sm text-sm font-semibold cursor-pointer disabled:opacity-50"
        >
          {saving ? 'Sparar…' : 'Klar'} <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}
