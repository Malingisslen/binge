'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePerson, usePersonCredits } from '@/hooks/useTMDB';
import { usePageMeta } from '@/hooks/usePageMeta';
import { JsonLd, breadcrumbSchema } from '@/components/title/JsonLd';
import { useSwedishWikiBio } from '@/hooks/useSwedishWikiBio';
import { profileUrl, getPersonEn, isAddableMediaType } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { translateDepartment } from '@/lib/tmdb/department';
import { splitSelfCredits } from '@/lib/tmdb/personCredits';
import { filmographyCompletion } from '@/lib/tmdb/filmographyCompletion';
import { buildPersonDescription } from '@/lib/seo/contentFloor';
import { personDescriptionInput } from '@/lib/seo/contentFloorInput';
import { useWatchlist } from '@/hooks/useWatchlist';
import TitleGrid from '@/components/title/TitleGrid';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoadingView } from '@/components/ui/LoadingView';
import { NotFound } from '@/components/ui/NotFound';
import { EmptyState } from '@/components/ui/EmptyState';
import type { TMDBPerson } from '@/types';

export default function PersonPageClient({ id, initialData }: { id: string; initialData?: TMDBPerson }) {
  const personId = parseInt(id, 10);
  const { data: person, isLoading } = usePerson(personId, initialData);
  // BIN-423 WP3: getPerson bifogar numera combined_credits, så filmografin
  // finns i build-seedad initialData (crawlbar i statisk HTML) OCH i den
  // klient-hämtade personen. Har vi den → hoppa över den separata
  // /combined_credits-queryn (en request mindre per förrenderad sida).
  const seededCredits = person?.combined_credits;
  // Hämta bara /combined_credits separat om personen laddats UTAN dem (sällsynt
  // nu när getPerson bifogar dem) — annars null, så vi slipper en bortkastad
  // request i fönstret innan person-objektet finns. Ger 2→1-request på ALLA
  // person-sidor, inte bara de förrenderade.
  const { data: fetchedCredits } = usePersonCredits(person && !seededCredits ? personId : null);
  const credits = seededCredits ?? fetchedCredits;
  const { getItem, loading: watchlistLoading } = useWatchlist();

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

  // BIN-187 — "Samla klart": completion meter over the films this person
  // directed. "Seen" = the film is in the library as 'sedd' (films have a clean
  // terminal watched state; TV-creator completion is a separate follow-up).
  const directedFilmIds = useMemo(() => {
    const ids = (credits?.crew ?? [])
      .filter(c => c.job === 'Director' && c.media_type === 'movie' && isAddableMediaType(c))
      .map(c => c.id);
    return Array.from(new Set(ids));
  }, [credits]);
  const directedMeter = useMemo(
    () => filmographyCompletion(directedFilmIds, tmdbId => getItem('movie', tmdbId)?.status === 'sedd'),
    [directedFilmIds, getItem],
  );
  // BIN-206 — gör mätaren aktionerbar: lista de osedda regisserade filmerna
  // (delmängd av filmografin nedan, men fokuserad på "samla klart"). Varje kort
  // länkar till titelsidan där man lägger till / markerar sedd. Härleds ur
  // `roles` (redan TitleGrid-typad) filtrerad på mätarens directed-id-set.
  const directedIdSet = useMemo(() => new Set(directedFilmIds), [directedFilmIds]);
  const unseenDirected = useMemo(
    // media_type-guard: TMDB-id:n är inte unika över medietyper, så en serie
    // personen spelat i med samma numeriska id som en regisserad film får inte
    // läcka in i "regisserade filmer" (directedIdSet bär bara numret).
    () => roles.filter(r => r.media_type === 'movie' && directedIdSet.has(r.id) && getItem('movie', r.id)?.status !== 'sedd'),
    [roles, directedIdSet, getItem],
  );

  // BIN-656: every person page used to ship the same sentence with only the name
  // swapped in — a duplicate meta description across the whole long tail. Prefer
  // a real Swedish bio; otherwise the facts we already have make the line unique.
  // The English TMDB bio is deliberately excluded: the body labels it "Biografi
  // på engelska", a search snippet can carry no such label.
  // BIN-686: the Wikipedia bio is excluded too, but for a LICENCE reason rather than a
  // labelling one — it is CC BY-SA and must carry its attribution wherever it travels.
  // The body can and does render the "Biografi från <källa>" credit link below; a <meta>
  // description, and the search snippet cut from it, cannot. So Wikipedia prose never
  // reaches the snippet — those people get the fact-based fallback line instead, which
  // is still unique per person.
  // Both halves go through the SAME adapter — the static route's generateMetadata
  // does too. Hand-rolling the mapping here is how the two drifted apart in the
  // first place, and a field added to the adapter would silently never reach this
  // side. (`contentFloorInput` pulls in @/lib/tmdb/providers, which this page's
  // TitleGrid → TitleCard chain already loads, so it costs no extra bundle here.)
  const metaDescription = useMemo(
    () => (person ? buildPersonDescription(personDescriptionInput(person)) : undefined),
    [person],
  );

  usePageMeta({
    title: person ? person.name : 'Person',
    description: metaDescription,
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
      {/* BIN-423 WP4: breadcrumb structured data (speglar movie/tv-sidorna) */}
      <JsonLd data={breadcrumbSchema([
        { name: 'Binge.nu', url: 'https://binge.nu/' },
        { name: person.name, url: `https://binge.nu/person/${person.id}/` },
      ])} />
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
          {/* BIN-734 asked for `hasSubstantialText(biography)` here, to match what
              BIN-688 did on the film and series pages. Deliberately NOT done, and
              this comment is the reason so the next pass does not re-apply it:
              BIN-735 (filed hours later, on the same threshold) established that
              the 60-character line is a SNIPPET-quality measure and must never
              decide whether real text appears on the page. On film and series
              pages a thin overview is now shown AND followed by the generated
              floor sentence, so nothing is lost. A person page has no visible
              generated paragraph to add — adding one is new UI, not a bug fix —
              so the same rule here means simply: keep the biography.

              What the shared predicate DOES still decide for a person is the
              <meta description> (buildPersonDescription), and it should: a
              two-word bio makes a poor search snippet while remaining perfectly
              good on the page. The body is a superset of the snippet either way,
              which is the property BIN-688 was protecting.

              The check is on the collapsed string so a whitespace-only TMDB bio
              cannot render an empty paragraph plus an orphan source credit. */}
          {biography.trim() && (
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

      {!watchlistLoading && directedMeter.total >= 3 && (
        <div className="mb-4 max-w-sm">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="font-bold text-ink-2">
              Regisserat — du har sett {directedMeter.seen} av {directedMeter.total}
            </span>
            <span className="text-ink-3">{directedMeter.pct}%</span>
          </div>
          <div
            className="h-[3px] bg-rule rounded-full overflow-hidden"
            role="progressbar"
            aria-valuenow={directedMeter.pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Regisserade filmer du har sett: ${directedMeter.seen} av ${directedMeter.total}`}
          >
            <div className="h-full bg-ink rounded-full" style={{ width: `${directedMeter.pct}%` }} />
          </div>
        </div>
      )}

      {/* BIN-206: de osedda regisserade filmerna — gör mätaren aktionerbar.
          Bakom en stängd <details> (samma idiom som Filmografi/Gästframträdanden)
          så den inte tränger undan biografin. */}
      {!watchlistLoading && directedMeter.total >= 3 && unseenDirected.length > 0 && (
        <details className="mb-4">
          <summary className="text-sm font-bold text-ink-2 mb-2 cursor-pointer select-none">
            Osedda att samla klart ({unseenDirected.length})
            <span className="ml-2 font-normal text-xxs text-ink-3">regisserade filmer du inte sett</span>
          </summary>
          <div className="bg-surface border border-rule rounded-sm">
            <TitleGrid items={unseenDirected} />
          </div>
        </details>
      )}

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
