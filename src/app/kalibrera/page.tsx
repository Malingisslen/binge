'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ThumbsUp, ThumbsDown, Sparkles, ChevronLeft } from 'lucide-react';
import AuthGuard from '@/components/AuthGuard';
import { useAuth } from '@/hooks/useAuth';
import { getTrending, posterUrl, backdropUrl } from '@/lib/tmdb/client';
import type { TMDBSearchResult } from '@/types';

const ROUND_SIZE = 10;

export default function KalibreraPage() {
  return <AuthGuard><KalibreraContent /></AuthGuard>;
}

function KalibreraContent() {
  const { setCalibrationGenres } = useAuth();
  const router = useRouter();

  const { data, isLoading } = useQuery({
    queryKey: ['kalibrera-candidates'],
    queryFn: () => getTrending('all', 'week'),
    staleTime: 60 * 60 * 1000,
  });

  const pool = useMemo(() => {
    const list = (data?.results ?? []).filter(r =>
      (r.media_type === 'movie' || r.media_type === 'tv')
      && r.poster_path
      && (r.genre_ids?.length ?? 0) > 0,
    );
    return list.slice(0, ROUND_SIZE);
  }, [data]);

  const [index, setIndex] = useState(0);
  const [votes, setVotes] = useState<Record<number, 'up' | 'down'>>({});
  const [saving, setSaving] = useState(false);

  const current: TMDBSearchResult | undefined = pool[index];
  const done = index >= pool.length && pool.length > 0;

  const onVote = (v: 'up' | 'down') => {
    if (!current) return;
    setVotes(prev => ({ ...prev, [current.id]: v }));
    setIndex(i => i + 1);
  };

  const onSkip = () => setIndex(i => i + 1);

  const submit = async () => {
    setSaving(true);
    try {
      const weights: Record<number, number> = {};
      for (const item of pool) {
        const vote = votes[item.id];
        if (!vote) continue;
        const w = vote === 'up' ? 1 : -0.5;
        for (const gid of item.genre_ids ?? []) {
          weights[gid] = (weights[gid] ?? 0) + w;
        }
      }
      await setCalibrationGenres(weights);
      router.push('/');
    } catch {
      setSaving(false);
    }
  };

  if (isLoading) {
    return <div className="text-sm text-text-muted py-4">Laddar...</div>;
  }

  if (pool.length === 0) {
    return (
      <div className="max-w-[560px]">
        <h1 className="text-[18px] font-bold mb-2">Kalibrera din smak</h1>
        <p className="text-xs text-text-muted mb-3">
          Kunde inte hämta titlar från TMDB. Försök igen senare.
        </p>
        <Link href="/" className="text-accent no-underline text-xs">← Tillbaka till startsidan</Link>
      </div>
    );
  }

  return (
    <div className="max-w-[520px]">
      <Link href="/" className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary no-underline mb-2">
        <ChevronLeft size={12} /> Startsidan
      </Link>

      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={18} className="text-accent" />
        <h1 className="text-[18px] font-bold text-text-primary">Kalibrera din smak</h1>
      </div>
      <p className="text-xs text-text-muted mb-4 leading-relaxed">
        Snabb-svep igenom 10 populära titlar. Tumme upp om du diggar vibben, tumme ner om det inte är din grej. Vi använder det för att färga dina rekommendationer och smak-match.
      </p>

      {!done && current && (
        <CalibrationCard item={current} onVote={onVote} onSkip={onSkip} progress={{ current: index + 1, total: pool.length }} />
      )}

      {done && (
        <div className="bg-surface border border-border-main rounded-sm p-4">
          <div className="text-sm font-semibold mb-1">Klar!</div>
          <div className="text-xs text-text-muted mb-3">
            {Object.keys(votes).length} av {pool.length} svar — resten räknades som &quot;vet inte&quot;.
          </div>
          <button
            onClick={submit}
            disabled={saving}
            className="px-3 py-[5px] bg-accent text-white rounded-sm text-xs font-semibold cursor-pointer border-none disabled:opacity-50"
          >
            {saving ? 'Sparar...' : 'Spara och gå till startsidan'}
          </button>
        </div>
      )}
    </div>
  );
}

function CalibrationCard({
  item, onVote, onSkip, progress,
}: {
  item: TMDBSearchResult;
  onVote: (v: 'up' | 'down') => void;
  onSkip: () => void;
  progress: { current: number; total: number };
}) {
  const title = item.title ?? item.name ?? '';
  const poster = posterUrl(item.poster_path, 'w500');
  const backdrop = backdropUrl(item.backdrop_path);
  const year = (item.release_date ?? item.first_air_date ?? '').slice(0, 4);

  return (
    <div className="bg-surface border border-border-main rounded-sm overflow-hidden">
      <div className="text-xxs text-text-muted px-3 py-[4px] border-b border-border-light">
        {progress.current}/{progress.total}
      </div>
      <div className="relative h-[180px] bg-[#2a2a2a] overflow-hidden">
        {backdrop && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={backdrop} alt="" className="w-full h-full object-cover object-[center_20%] opacity-60" loading="eager" decoding="async" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/20 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 px-3 pb-2 flex gap-3 items-end">
          {poster && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={poster} alt={title} className="w-[70px] rounded-sm relative z-10" loading="eager" decoding="async" width={70} height={105} />
          )}
          <div className="relative z-10 pb-1 min-w-0">
            <div className="text-sm font-bold text-text-primary leading-tight truncate">{title}</div>
            <div className="text-xxs text-text-muted">
              {item.media_type === 'movie' ? 'Film' : 'Serie'}{year ? ` · ${year}` : ''}
            </div>
          </div>
        </div>
      </div>
      <p className="text-xs text-text-secondary leading-relaxed px-3 py-2 m-0 min-h-[50px]">
        {item.overview || <span className="text-text-muted italic">Ingen beskrivning.</span>}
      </p>
      <div className="flex gap-1 px-3 py-2 border-t border-border-light">
        <button
          onClick={() => onVote('down')}
          className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-[6px] border border-border-main rounded-sm text-xs font-semibold bg-white cursor-pointer hover:bg-red-50 hover:border-red-300"
        >
          <ThumbsDown size={12} /> Inte min grej
        </button>
        <button
          onClick={onSkip}
          className="px-3 py-[6px] border border-border-main rounded-sm text-xs bg-white cursor-pointer text-text-muted"
          title="Hoppa över"
        >
          Hoppa
        </button>
        <button
          onClick={() => onVote('up')}
          className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-[6px] border border-accent rounded-sm text-xs font-semibold bg-accent text-white cursor-pointer hover:bg-accent/90"
        >
          <ThumbsUp size={12} /> Diggar
        </button>
      </div>
    </div>
  );
}
