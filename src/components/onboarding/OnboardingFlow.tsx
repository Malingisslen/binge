'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, ArrowLeft, Check, Search, Target } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useSearch } from '@/hooks/useTMDB';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { SWEDISH_PROVIDERS } from '@/lib/tmdb/providers';
import { mergeUserDoc } from '@/lib/firebase/userDocWrite';
import { trackEvent } from '@/lib/analytics';
import { posterUrl, getDisplayTitle, getReleaseYear, isAddableMediaType } from '@/lib/tmdb/client';
import { toneForGenreIds, toneForId } from '@/lib/duotone';
import { buildWatchlistAddPayload } from '@/lib/watchlist/buildAddPayload';
import { takeNextPath } from '@/lib/nextPath';
import { useToast } from '@/contexts/ToastContext';
import { DELETION_IN_PROGRESS_MESSAGE, isDeletionInProgressError } from '@/lib/deletionInProgressError';
import {
  LIBRARY_UNREACHABLE_TITLE,
  LIBRARY_UNREACHABLE_BODY,
  LIBRARY_RETRY_LABEL,
  LIBRARY_LOADING,
} from '@/lib/watchlist/libraryHoldCopy';
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

/**
 * BIN-659: one SHAPE for every failed write in the flow — the situation is
 * always the same (the write did not land, the same button is the retry), but
 * the wording is not: each caller names what it could not save, because "Kunde
 * inte spara" alone leaves the visitor guessing which of the step's actions
 * failed. An earlier draft exported a shared default string; nothing ever
 * rendered it, so it was a constant claiming to be the single source of a
 * wording the flow deliberately varies.
 *
 * `border-danger/30` (not `border-rule`) to match the other danger banners —
 * GroupPageClient uses exactly this; the design system's danger token, not a raw
 * red.
 */
function SaveError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="text-xs text-danger-ink bg-danger-soft border border-danger/30 rounded-sm px-3 py-2 mb-3"
    >
      {message}
    </p>
  );
}

export function OnboardingFlow() {
  const router = useRouter();
  const { uid, user } = useAuth();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  if (!uid || !user) return null;

  /**
   * BIN-659: every step change goes through here, so the completion error can
   * never outlive the step it was raised on. `saveFailed` belongs to `finish`,
   * and "Hoppa över" reaches `finish` from EVERY step — so a failed skip on
   * step 1 would otherwise leave "Kunde inte spara att du är klar" sitting under
   * the card while the visitor works through steps 2-4 for unrelated reasons.
   * The per-step errors need no such reset: those components unmount on a step
   * change and lose their local state for free.
   */
  const goToStep = (next: 1 | 2 | 3 | 4) => {
    setSaveFailed(false);
    setStep(next);
  };

  // Markerar onboarding som klar och navigerar. `destination` låter
  // Kalibrera-CTA:n slutföra onboardingen INNAN den routar till /kalibrera/
  // — annars lämnade primärknappen flödet med onboardingCompletedAt osatt.
  const finish = async (destination?: string) => {
    setSaving(true);
    setSaveFailed(false);
    try {
      // BIN-816: the eighth users/{uid} merge writer the panel counted, and the
      // one outside AuthContext. Its `!user` guard never helped — React state is
      // not cleared by an aborted cascade — so it goes through the chokepoint
      // like the rest.
      await mergeUserDoc(uid, kit => ({ onboardingCompletedAt: kit.serverTimestamp() }));
      trackEvent('onboarding_completed', { step_reached: step });
      // BIN-669: sign-in remembered where they were (the poster badge on a
      // prerendered title page is the funnel), then routed them here instead.
      // Onboarding is the last leg of that trip, so it is what hands them back.
      // Consumed unconditionally — even when the Kalibrera CTA names its own
      // destination — because a value left in storage would aim the NEXT
      // sign-in in this tab at a page that is by then long stale.
      const remembered = takeNextPath();
      router.push(destination ?? remembered ?? '/');
    } catch (err) {
      // BIN-659: this rejected unhandled before, so a failed write left the
      // visitor on the last step with a dead-looking button and no idea the
      // account was still flagged as un-onboarded. Navigation stays blocked on
      // purpose — advancing past a write that did not land is the actual bug.
      console.error('Onboarding finish failed:', err);
      setSaveFailed(true);
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
      <div className="mt-6 bg-surface border border-rule rounded-sm p-6">
        {step === 1 && <StepWelcome onNext={() => goToStep(2)} />}
        {step === 2 && <StepProviders onBack={() => goToStep(1)} onNext={() => goToStep(3)} />}
        {step === 3 && <StepFirstTitle onBack={() => goToStep(2)} onNext={() => goToStep(4)} />}
        {step === 4 && <StepDone onBack={() => goToStep(3)} onFinish={finish} saving={saving} />}
      </div>
      {/* Below the card: `finish` is reachable from both the card's buttons and
          "Hoppa över", so its error belongs to neither one alone. */}
      {saveFailed && (
        <div className="mt-4">
          <SaveError message="Kunde inte spara att du är klar. Kontrollera anslutningen och försök igen." />
        </div>
      )}
      <div className="mt-4 text-center">
        <button
          onClick={skip}
          disabled={saving}
          className="text-xxs text-ink-3 hover:text-ink-2 bg-transparent border-none cursor-pointer disabled:opacity-50"
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
            i + 1 <= current ? 'bg-acc-deep' : 'bg-rule-2'
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
      <p className="text-sm text-ink-2 mb-4">
        Håll koll på vad du tittar på och se var filmer och serier streamas i
        Sverige. Tre steg.
      </p>
      <ul className="space-y-2 mb-6 text-sm text-ink-2">
        <li className="flex items-start gap-2">
          <Check size={14} className="text-acc-deep mt-[3px] shrink-0" />
          <span>Välj vilka streamingtjänster du har</span>
        </li>
        <li className="flex items-start gap-2">
          <Check size={14} className="text-acc-deep mt-[3px] shrink-0" />
          <span>Lägg till något du vill se eller redan följer</span>
        </li>
        <li className="flex items-start gap-2">
          <Check size={14} className="text-acc-deep mt-[3px] shrink-0" />
          <span>Få rekommendationer baserat på din smak</span>
        </li>
      </ul>
      <button
        onClick={onNext}
        className="inline-flex items-center gap-2 px-4 py-2 bg-acc-deep text-white rounded-sm text-sm font-semibold cursor-pointer"
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
  const [saveFailed, setSaveFailed] = useState(false);

  const toggle = (id: number) =>
    setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));

  const flatrateProviders = SWEDISH_PROVIDERS.filter(p => p.type === 'flatrate');

  const save = async () => {
    setSaving(true);
    setSaveFailed(false);
    try {
      await updateProviders(selected);
      onNext();
    } catch (err) {
      // BIN-659: a rejected write used to leave "Nästa" looking simply dead —
      // the step never advanced and nothing said why. The selection is still in
      // state, so the same button is the retry.
      console.error('Onboarding provider save failed:', err);
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h1 className="page-h1" style={{ marginBottom: 12 }}>
        Vilka tjänster har du?
      </h1>
      <p className="text-sm text-ink-2 mb-4">
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
                  ? 'border-acc-deep bg-acc-deep/[0.05] text-ink'
                  : 'border-rule bg-white text-ink-2'
              }`}
            >
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ background: p.color }}
              />
              <span className="text-sm flex-1 truncate">{p.shortName}</span>
              {isSelected && <Check size={12} className="text-acc-deep shrink-0" />}
            </button>
          );
        })}
      </div>
      {saveFailed && (
        <SaveError message="Kunde inte spara dina tjänster. Kontrollera anslutningen och försök igen." />
      )}
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 px-3 py-2 border border-rule rounded-sm text-sm bg-white cursor-pointer"
        >
          <ArrowLeft size={14} /> Tillbaka
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 bg-acc-deep text-white rounded-sm text-sm font-semibold cursor-pointer disabled:opacity-50"
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
  // BIN-643: gated on `libraryKnown` like every other add surface (BIN-596).
  //
  // This deliberately REVERSES the earlier note here, which argued the step is
  // safe ungated because a brand-new account has no library to protect. That was
  // true of the overwrite risk and wrong about the rest: on a DEAD listener a
  // title marked "Sedd" here lands with no `watchedAt` (upsertTitle's own guards
  // suppress the stamp when it cannot tell a new add from a re-mark), and unlike
  // a missing `addedAt` that half never self-heals. It also is not always a new
  // account — this flow is reachable for anyone whose `onboardingCompletedAt` is
  // unset, including an existing library.
  //
  // The cost is one snapshot's wait on the very first add, which lands in well
  // under a second; the failed case says so and offers a retry, and "Hoppa över"
  // stays live throughout so a dead listener can never trap someone inside
  // onboarding. BIN-700/643/729 are one answer at three sites — see
  // `src/lib/watchlist/libraryHoldCopy.ts`.
  const { items, upsertTitle, libraryKnown, listenerFailed, retryListener } = useWatchlist();
  const [addFailed, setAddFailed] = useState(false);
  const { show: toast } = useToast();

  const canContinue = items.length > 0;

  // TV: en väg — "Följ" (status mina; ej påbörjad tills första avsnittet
  // markeras). Film: intent 'plan' → vill_se, 'engage' → sedd.
  const handleAdd = async (
    result: TMDBSearchResult & { media_type: 'movie' | 'tv' },
    intent: 'plan' | 'engage',
  ) => {
    // Belt-and-braces behind the disabled buttons (BIN-643).
    if (!libraryKnown) return;
    const title = getDisplayTitle(result);
    const status: WatchStatus = result.media_type === 'tv'
      ? 'mina'
      : (intent === 'plan' ? 'vill_se' : 'sedd');
    setAddFailed(false);
    try {
      await upsertTitle(buildWatchlistAddPayload({
        tmdbId: result.id,
        mediaType: result.media_type,
        status,
        title,
        posterPath: result.poster_path,
        releaseYear: getReleaseYear(result),
        genreIds: result.genre_ids ?? [],
        // Genuine new add with no `current` and no provider data on this surface.
        // Explicit [] (not omitted) so the created doc satisfies WatchlistItem's
        // non-optional array contract; taste/backfill owns filling it in later, and
        // shouldStampProvidersAtAdd deliberately does not stamp on an empty list.
        providers: [],
      }));
    } catch (err) {
      // BIN-1038: a refusal during an account deletion is NOT the retryable failure this
      // catch was written for. `SaveError` below says "kontrollera anslutningen och försök
      // igen", and the deletion marker does not clear on its own — so every retry fails
      // identically. Same reasoning #19 Customer Support used to block BIN-1032's generic
      // message on `ReconsentGate`, and the same fix `useMarkSeen`'s series branch got.
      if (isDeletionInProgressError(err)) {
        toast(DELETION_IN_PROGRESS_MESSAGE);
        return;
      }
      // BIN-659: the add rejected unhandled, so the row simply never turned into
      // "Tillagd" — indistinguishable from a missed tap, and "Nästa" stayed
      // disabled with nothing explaining it. The row's button is the retry.
      console.error('Onboarding first-title add failed:', err);
      setAddFailed(true);
    }
  };

  return (
    <div>
      <h1 className="page-h1" style={{ marginBottom: 12 }}>
        Lägg till din första titel
      </h1>
      <p className="text-sm text-ink-2 mb-4">
        Sök efter en film eller serie. Serier följer du; filmer markerar du
        som vill se eller sedda.
      </p>
      <div className="flex items-center gap-2 mb-3 border border-rule rounded-sm bg-white px-2">
        <Search size={13} className="text-ink-3" />
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
        <div className="text-xs text-ink-3 py-2">Söker…</div>
      )}

      {searchData && searchData.results.length > 0 && (
        <ul className="space-y-1 mb-4 max-h-[280px] overflow-y-auto">
          {searchData.results
            .filter(isAddableMediaType)
            .slice(0, 6)
            .map(r => {
              // BIN-664: tmdbId alone is not an identity. TMDB numbers movies
              // and series in SEPARATE sequences, so id 1399 is both Game of
              // Thrones and an unrelated film — matching on the number alone
              // showed the second one as "Tillagd" with no way to add it, and
              // (with one title added) let the visitor leave step 3 believing
              // they had tracked something they had not. The watchlist doc id is
              // mediaType-namespaced for the same reason (BIN-560).
              const alreadyAdded = items.some(
                i => i.tmdbId === r.id && i.mediaType === r.media_type,
              );
              const poster = posterUrl(r.poster_path, 'w92');
              return (
                <li
                  key={r.id}
                  className="flex items-center gap-2 px-2 py-[5px] bg-white border border-rule rounded-sm"
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
                    <div className="text-xs font-semibold text-ink truncate">
                      {getDisplayTitle(r)}
                    </div>
                    <div className="text-xxs text-ink-3">
                      {r.media_type === 'movie' ? 'Film' : 'Serie'}
                      {getReleaseYear(r) ? ` · ${getReleaseYear(r)}` : ''}
                    </div>
                  </div>
                  {alreadyAdded ? (
                    <span className="text-xxs text-acc-deep inline-flex items-center gap-1">
                      <Check size={11} /> Tillagd
                    </span>
                  ) : r.media_type === 'tv' ? (
                    <button
                      onClick={() => handleAdd(r, 'engage')}
                      disabled={!libraryKnown}
                      className="text-xxs px-2 py-[3px] bg-acc-deep text-white rounded-sm cursor-pointer disabled:opacity-50"
                    >
                      Följ
                    </button>
                  ) : (
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleAdd(r, 'plan')}
                        disabled={!libraryKnown}
                        className="text-xxs px-2 py-[3px] border border-rule rounded-sm bg-white cursor-pointer disabled:opacity-50"
                      >
                        Vill se
                      </button>
                      <button
                        onClick={() => handleAdd(r, 'engage')}
                        disabled={!libraryKnown}
                        className="text-xxs px-2 py-[3px] bg-acc-deep text-white rounded-sm cursor-pointer disabled:opacity-50"
                      >
                        Sedd
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
        </ul>
      )}

      {addFailed && (
        <SaveError message="Kunde inte lägga till titeln. Kontrollera anslutningen och försök igen." />
      )}

      {/* BIN-643 — why the add buttons are held. The failed half never resolves
          on its own, so it carries the retry; the transient half is one snapshot
          away and just says so. "Hoppa över" below stays live in both. */}
      {!libraryKnown && (
        listenerFailed ? (
          <div role="alert" className="text-xs text-danger-ink bg-danger-soft border border-danger/30 rounded-sm px-3 py-2 mb-3">
            <p className="font-semibold">{LIBRARY_UNREACHABLE_TITLE}</p>
            <p className="mt-1 text-ink-2">{LIBRARY_UNREACHABLE_BODY}</p>
            <button type="button" onClick={retryListener} className="btn btn-acc btn-sm mt-2">
              {LIBRARY_RETRY_LABEL}
            </button>
          </div>
        ) : (
          <p className="text-xs text-ink-3 mb-3">{LIBRARY_LOADING}</p>
        )
      )}

      {items.length > 0 && (
        <div className="text-xs text-acc-deep mb-3">
          <Check size={11} className="inline mb-[2px] mr-1" />
          {items.length} titel{items.length === 1 ? '' : 'ar'} tillagd{items.length === 1 ? '' : 'a'}.
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 px-3 py-2 border border-rule rounded-sm text-sm bg-white cursor-pointer"
        >
          <ArrowLeft size={14} /> Tillbaka
        </button>
        <button
          onClick={onNext}
          disabled={!canContinue}
          className="inline-flex items-center gap-2 px-4 py-2 bg-acc-deep text-white rounded-sm text-sm font-semibold cursor-pointer disabled:opacity-50"
        >
          Nästa <ArrowRight size={14} />
        </button>
        {!canContinue && (
          <button
            onClick={onNext}
            className="text-xxs text-ink-3 hover:text-ink-2 bg-transparent border-none cursor-pointer ml-auto"
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
  onFinish: (destination?: string) => Promise<void>;
  saving: boolean;
}) {
  return (
    <div>
      <h1 className="page-h1" style={{ marginBottom: 12 }}>
        Klar.
      </h1>
      <p className="text-sm text-ink-2 mb-4">
        Lägg till fler titlar, utforska rekommendationer eller se var dina
        serier streamas.
      </p>

      <div className="bg-acc-deep/[0.06] border border-acc-deep/30 rounded-sm p-3 mb-4">
        <div className="flex items-start gap-2 mb-2">
          <Target size={14} className="text-acc-deep mt-[2px] shrink-0" />
          <div className="flex-1">
            <div className="text-sm font-bold text-ink">
              Kalibrera smaken
            </div>
            <p className="text-xxs text-ink-3 mt-1">
              Ranka 10 genrer du gillar så blir rekommendationerna skarpare.
              Cirka 2 minuter — kan göras senare från inställningarna.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onFinish('/kalibrera/')}
            disabled={saving}
            className="inline-flex items-center gap-1 px-3 py-[5px] bg-acc-deep text-white rounded-sm text-xs font-semibold cursor-pointer disabled:opacity-50"
          >
            <Target size={11} /> Kalibrera smak
          </button>
          <button
            onClick={() => onFinish()}
            disabled={saving}
            className="px-3 py-[5px] border border-rule rounded-sm text-xs bg-white cursor-pointer disabled:opacity-50"
          >
            Senare
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          disabled={saving}
          className="inline-flex items-center gap-1 px-3 py-2 border border-rule rounded-sm text-sm bg-white cursor-pointer disabled:opacity-50"
        >
          <ArrowLeft size={14} /> Tillbaka
        </button>
        <button
          onClick={() => onFinish()}
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 bg-acc-deep text-white rounded-sm text-sm font-semibold cursor-pointer disabled:opacity-50"
        >
          {saving ? 'Sparar…' : 'Klar'} <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}
