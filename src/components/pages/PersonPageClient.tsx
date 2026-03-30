'use client';

import { useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePerson, usePersonCredits } from '@/hooks/useTMDB';
import { profileUrl, getPersonEn } from '@/lib/tmdb/client';
import TitleGrid from '@/components/title/TitleGrid';

export default function PersonPageClient({ id }: { id: string }) {
  const personId = parseInt(id, 10);
  const { data: person, isLoading } = usePerson(personId);
  const { data: credits } = usePersonCredits(personId);

  // Fallback to English bio if Swedish is empty
  const { data: personEn } = useQuery({
    queryKey: ['person-en', personId],
    queryFn: () => getPersonEn(personId),
    enabled: !!person && !person.biography,
    staleTime: 30 * 60 * 1000,
  });

  const biography = person?.biography || personEn?.biography || '';

  const uniqueCredits = useMemo(() => {
    const allCredits = [
      ...(credits?.cast ?? []).map(c => ({ ...c, role: c.character })),
      ...(credits?.crew ?? []).filter(c => c.job === 'Director' || c.job === 'Creator').map(c => ({ ...c, role: c.job })),
    ];
    const seen = new Set<string>();
    return allCredits
      .filter(c => {
        const key = `${c.media_type}-${c.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return c.media_type === 'movie' || c.media_type === 'tv';
      })
      .sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0));
  }, [credits]);

  useEffect(() => {
    if (person) document.title = `${person.name} — Binge.nu`;
    return () => { document.title = 'Binge.nu — Håll koll på vad du tittar på'; };
  }, [person]);

  if (isLoading) return <div className="text-sm text-text-muted py-4">Laddar...</div>;
  if (!person) return <div className="text-sm text-text-muted py-4">Personen hittades inte.</div>;

  const photo = profileUrl(person.profile_path, 'w500');
  const birthYear = person.birthday?.substring(0, 4);

  return (
    <div>
      <div className="flex flex-col md:flex-row gap-4 mb-4">
        <div className="shrink-0">
          {photo ? (
            <img src={photo} alt={person.name} className="w-[120px] md:w-[180px] rounded-sm" />
          ) : (
            <div className="w-[180px] aspect-[2/3] bg-[#ddd8d0] rounded-sm" />
          )}
        </div>
        <div className="flex-1">
          <h1 className="text-[18px] font-bold text-text-primary mb-1">{person.name}</h1>
          <div className="text-sm text-text-muted mb-2">
            {person.known_for_department}
            {birthYear && ` · Född ${birthYear}`}
            {person.place_of_birth && ` · ${person.place_of_birth}`}
          </div>
          {biography && (
            <p className="text-base text-text-secondary leading-relaxed mb-3 line-clamp-6">{biography}</p>
          )}
        </div>
      </div>

      {uniqueCredits.length > 0 && (
        <div className="mb-4">
          <h2 className="text-sm font-bold text-text-secondary mb-2">Filmografi ({uniqueCredits.length})</h2>
          <div className="bg-surface border border-border-main rounded-sm">
            <TitleGrid items={uniqueCredits} />
          </div>
        </div>
      )}
    </div>
  );
}
