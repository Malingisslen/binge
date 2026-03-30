'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useReviewsForTitle, useReviewActions } from '@/hooks/useReviews';
import { useAuth } from '@/hooks/useAuth';
import type { MediaType } from '@/types';

interface ReviewListProps {
  tmdbId: number;
  mediaType: MediaType;
}

export default function ReviewList({ tmdbId, mediaType }: ReviewListProps) {
  const { data: reviews, isLoading } = useReviewsForTitle(tmdbId);
  const { submitReview, deleteReview } = useReviewActions();
  const { uid } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [text, setText] = useState('');
  const [spoiler, setSpoiler] = useState(false);

  if (isLoading) return null;
  if (!reviews) return (
    <div className="mb-4">
      <h2 className="text-sm font-bold text-text-secondary mb-2">Recensioner</h2>
      <p className="text-xs text-text-muted">Kunde inte ladda recensioner.</p>
    </div>
  );

  const myReview = reviews.find(r => r.uid === uid);
  const otherReviews = reviews.filter(r => r.uid !== uid);

  const handleSubmit = async () => {
    if (!text.trim()) return;
    await submitReview(tmdbId, mediaType, text.trim(), spoiler, null, myReview?.id);
    setText('');
    setSpoiler(false);
    setShowForm(false);
  };

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-sm font-bold text-text-secondary">Recensioner ({reviews.length})</h2>
        {uid && !myReview && (
          <button
            onClick={() => setShowForm(true)}
            className="px-[7px] py-[2px] text-xs rounded-sm cursor-pointer bg-accent text-white border-none font-[inherit]"
          >
            Skriv
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-surface border border-border-main rounded-sm p-3 mb-2">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Skriv din recension..."
            maxLength={2000}
            rows={3}
            className="w-full px-2 py-1 text-xs border border-border-main rounded-sm bg-white font-[inherit] resize-none outline-none mb-2"
          />
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-text-muted cursor-pointer">
              <input type="checkbox" checked={spoiler} onChange={e => setSpoiler(e.target.checked)} className="accent-accent" />
              Spoiler
            </label>
            <button onClick={handleSubmit} className="px-3 py-[3px] text-xs border-none rounded-sm cursor-pointer bg-accent text-white font-[inherit]">
              Publicera
            </button>
            <button onClick={() => setShowForm(false)} className="px-3 py-[3px] text-xs border border-border-main rounded-sm cursor-pointer bg-surface text-text-muted font-[inherit]">
              Avbryt
            </button>
          </div>
        </div>
      )}

      {myReview && (
        <ReviewCard review={myReview} isOwn onDelete={() => deleteReview(myReview.id, tmdbId)} />
      )}
      {otherReviews.map(r => (
        <ReviewCard key={r.id} review={r} />
      ))}

      {reviews.length === 0 && !showForm && (
        <p className="text-xs text-text-muted">Inga recensioner ännu.</p>
      )}
    </div>
  );
}

function ReviewCard({ review, isOwn, onDelete }: { review: import('@/types').Review; isOwn?: boolean; onDelete?: () => void }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="bg-surface border border-border-main rounded-sm px-3 py-2 mb-[6px]">
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs">
          {review.username ? (
            <Link href={`/user/${review.username}/`} className="font-semibold text-text-primary no-underline hover:text-accent">
              {review.displayName}
            </Link>
          ) : (
            <span className="font-semibold text-text-primary">{review.displayName}</span>
          )}
          <span className="text-text-muted ml-2">{review.createdAt.toLocaleDateString('sv-SE')}</span>
        </div>
        {isOwn && onDelete && (
          <button onClick={onDelete} className="text-xxs text-red-500 bg-transparent border-none cursor-pointer font-[inherit]">Ta bort</button>
        )}
      </div>
      {review.spoiler && !revealed ? (
        <div>
          <span className="text-xs text-text-muted blur-sm select-none">{review.text.slice(0, 100)}</span>
          <button onClick={() => setRevealed(true)} className="text-xxs text-accent ml-1 bg-transparent border-none cursor-pointer font-[inherit]">
            Visa spoiler
          </button>
        </div>
      ) : (
        <p className="text-xs text-text-secondary leading-relaxed m-0">{review.text}</p>
      )}
    </div>
  );
}
