'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePerson, usePersonCredits } from '@/hooks/useTMDB';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useSwedishWikiBio } from '@/hooks/useSwedishWikiBio';
import { profileUrl, getPersonEn, isAddableMediaType } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { translateDepartment } from '@/lib/tmdb/department';
import { splitSelfCredits } from '@/lib/tmdb/personCredits';
import TitleGrid from '@/components/title/TitleGrid';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoadingView } from '@/components/ui/LoadingView';
import { NotFound } from '@/components/ui/NotFound';
import { EmptyState } from '@/components/ui/EmptyState';
import type { TMDBPerson } from '@/types';

export default function PersonPageClient({ id, initialData }: { id: string; initialData?: TMDBPerson }) {
  const personId = parseInt(id, 10);
  const { data: person, isLoading } = usePerson(personId, initialData);
  const { data: credits } = usePersonCredits(personId);

  const svBio = person?.biography || '';

  // Only fetch Wikipedia fallback when TMDB has no Swedish bio.
  const wikiBio = useSwedishWikiBio(person?.id, !!person && !svBio);

  // Fallback to English TMDB bio if both Swedish sources are empty.
  const { data: personEn } = useQuery({
    queryKey: ['person-en', personId],
    queryFn: () => getPersonEn(personId),
    enabled: !!person && !svBio,
    staleTime: TMDB_STALE.PERSON,
  });

  const enBio = personEn?.biography || '';

  // Precedence: sv TMDB → sv Wikipedia → en TMDB
  const biography = svBio || wikiBio?.text || enBio || '';
  const bioSource: 'tmdb-sv' | 'wiki-sv' | 'tmdb-en' | null =
    svBio ? 'tmdb-sv' : wikiBio?.text ? 'wiki-sv' : enBio ? 'tmdb-en' : null;

  // PE3: separera Self-gästframträdanden (talkshows, galor) från riktiga
  // roller så filmografin inte dränks i dem.
  const { roles, selfCredits } = useMemo(() => {
    const allCredits = [
      ...(credits?.cast ?? []).map(c => ({ ...c, role: c.character })),
      ...(credits?.crew ?? []).filter(c => c.job === 'Director' || c.job === 'Creator').map(c => ({ ...c, role: c.job })),
    ];
    const seen = new Set<string>();
    const unique = allCredits
      .filter(c => {
        const key = `${c.media_type}-${c.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return isAddableMediaType(c);
      })
      .sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0));
    return splitSelfCredits(unique);
  }, [credits]);

  usePageMeta({
    title: person ? person.name : 'Person',
    description: person
      ? `${person.name} — skådespelare och filmskapare. Se filmer och serier med ${person.name} och vad du kan streama i Sverige.`
      : undefined,
    ogImage: person?.profile_path ? profileUrl(person.profile_path, 'w500') ?? undefined : undefined,
    // Tar bort catch-all-shellets noindex när TMDB bekräftat att personen finns.
    // Pre-renderade /person/[id] (topp-N) påverkas inte — egen statisk HTML.
    indexable: !!person,
  });

  if (isLoading) return <LoadingView variant="detail" label="Laddar person…" />;
  if (!person) return <NotFound crumb="Person" title="Personen hittades inte." body="Vi kunde inte hitta den här personen i TMDB." />;

  const photo = profileUrl(person.profile_path, 'w500');
  const birthYear = person.birthday?.substring(0, 4);

  return (
    <div>
      <PageHeader
        crumb={translateDepartment(person.known_for_department)}
        title={person.name}
        standfirst={[birthYear && `Född ${birthYear}`, person.place_of_birth].filter(Boolean).join(' · ') || undefined}
      />

      <div className="flex flex-col md:flex-row gap-4 mb-4 mt-3">
        <div className="shrink-0">
          {photo ? (
            <img src={photo} alt={person.name} className="w-[120px] md:w-[180px] rounded-sm" loading="eager" fetchPriority="high" decoding="async" width={180} height={270} />
          ) : (
            <div className="w-[180px] aspect-[2/3] bg-rule-2 rounded-sm" />
          )}
        </div>
        <div className="flex-1">
          {biography && (
            <>
              <p className="text-base text-ink-2 leading-relaxed mb-3 line-clamp-6">{biography}</p>
              {bioSource === 'wiki-sv' && wikiBio && (
                <p className="text-xxs text-ink-3 mb-3">
                  Biografi från{' '}
                  <a href={wikiBio.pageUrl} target="_blank" rel="noopener noreferrer" className="underline">
                    svenska Wikipedia
                  </a>{' '}
                  (CC BY-SA).
                </p>
              )}
              {bioSource === 'tmdb-en' && (
                <p className="text-xxs text-ink-3 mb-3">Biografi på engelska — svensk översättning saknas.</p>
              )}
            </>
          )}
        </div>
      </div>

      {roles.length > 0 && (
        <div className="mb-4">
          <h2 className="text-sm font-bold text-ink-2 mb-2">Filmografi ({roles.length})</h2>
          <div className="bg-surface border border-rule rounded-sm">
            <TitleGrid items={roles} />
          </div>
        </div>
      )}

      {selfCredits.length > 0 && (
        <details className="mb-4">
          <summary className="text-sm font-bold text-ink-2 mb-2 cursor-pointer select-none">
            Gästframträdanden ({selfCredits.length})
            <span className="ml-2 font-normal text-xxs text-ink-3">talkshows, galor, dokumentärer — som sig själv</span>
          </summary>
          <div className="bg-surface border border-rule rounded-sm">
            <TitleGrid items={selfCredits} />
          </div>
        </details>
      )}

      {roles.length === 0 && selfCredits.length === 0 && (
        <EmptyState title="Ingen filmografi" body="Vi hittade inga titlar för den här personen ännu." />
      )}
    </div>
  );
}
