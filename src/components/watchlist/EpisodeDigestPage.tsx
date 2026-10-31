'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoadingView } from '@/components/ui/LoadingView';
import { EmptyState } from '@/components/ui/EmptyState';
import { cardClass } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useNotifications } from '@/hooks/useNotifications';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useEpisodeProgressWithSync } from '@/hooks/useEpisodeProgressWithSync';
import { useToast } from '@/contexts/ToastContext';
import type { DigestEpisode } from '@/hooks/useNotifications';
import { isEpisodeSeen, episodeCodeLabel } from '@/lib/episodeDigest';
import { posterUrl, titleHref } from '@/lib/tmdb/client';

export const EPISODE_DIGEST_TITLE = 'Nya avsnitt';

// BIN-1475: listan som morgonnotisen öppnar. Att inte bocka av något är ett giltigt
// svar: ingenting skrivs och ingenting räknas.

// One row per episode, so each can use the same per-show write as the episode list
// on the series page (episodeProgress and the watchlist marker together).
function DigestRow({ ep, posterPath, seen }: { ep: DigestEpisode; posterPath: string | null; seen: boolean }) {
  const { markEpisodeWatched } = useEpisodeProgressWithSync(ep.tmdbId);
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const code = episodeCodeLabel(ep.season, ep.episode);
  const poster = posterUrl(posterPath, 'w92');
  const onTick = async () => {
    setBusy(true);
    try { await markEpisodeWatched(ep.season, ep.episode, true); }
    catch { show('Det gick inte att markera avsnittet. Försök igen.'); }
    finally { setBusy(false); }
  };
  return (
    <li className={cardClass('flex items-center gap-3 p-3')}>
      {poster
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={poster} alt="" width={40} height={60} loading="lazy" className="rounded-sm shrink-0" />
        : <div className="w-[40px] h-[60px] rounded-sm bg-bg-2 shrink-0" aria-hidden />}
      <Link href={titleHref('tv', ep.tmdbId)} className="flex-1 min-w-0">
        <div className="text-md font-semibold text-ink truncate">{ep.title}</div>
        <div className="text-sm text-ink-3">{code}</div>
      </Link>
      {seen ? (
        <span className="chip is-on" aria-label={`${ep.title} markerad som sedd`}><Check size={14} aria-hidden /> Sedd</span>
      ) : (
        <button type="button" className="chip" disabled={busy} aria-label={`Markera ${ep.title} ${code} som sedd`} onClick={() => { void onTick(); }}>
          Sedd?
        </button>
      )}
    </li>
  );
}

// BIN-1475: listan som morgonnotisen öppnar. Att inte bocka av något är ett giltigt
// svar: ingenting skrivs och ingenting räknas.
export default function EpisodeDigestPage() {
  const router = useRouter();
  const { notifications, markRead } = useNotifications();
  const { items, loading } = useWatchlist();
  const digest = notifications.find(n => n.kind === 'episode_digest');

  // useNotifications has no loading state; an empty inbox gets a moment before the
  // page says there is nothing, so a push tap does not flash the empty view.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 2500);
    return () => clearTimeout(t);
  }, []);

  // Opening the list is enough to clear the badge; there is no "unanswered" state.
  const digestId = digest?.id;
  const digestRead = digest?.read ?? true;
  useEffect(() => {
    if (digestId && !digestRead) void markRead(digestId);
  }, [digestId, digestRead, markRead]);

  const header = (
    <PageHeader
      crumb="Mitt Binge · nya avsnitt"
      title={digest?.title ?? EPISODE_DIGEST_TITLE}
      standfirst="Bocka av det du hunnit se. Resten ligger kvar som vanligt."
    />
  );

  if (loading || (!digest && !waited)) return <>{header}<LoadingView variant="grid" label="Laddar nya avsnitt…" /></>;
  if (!digest || !digest.episodes || digest.episodes.length === 0) {
    return (
      <>
        {header}
        <EmptyState title="Inga nya avsnitt just nu." body="Du får en notis på morgonen när något nytt har kommit." />
      </>
    );
  }

  return (
    <>
      {header}
      <ul className="mt-5 flex flex-col gap-2">
        {digest.episodes.map(ep => {
          const item = items.find(i => i.mediaType === 'tv' && i.tmdbId === ep.tmdbId);
          return (
            <DigestRow
              key={`${ep.tmdbId}-${ep.season}-${ep.episode}`}
              ep={ep}
              posterPath={item?.posterPath ?? null}
              seen={isEpisodeSeen(item, ep.season, ep.episode)}
            />
          );
        })}
      </ul>
      <div className="mt-5">
        <Button variant="acc" onClick={() => router.push('/my/')}>Klar</Button>
      </div>
    </>
  );
}
