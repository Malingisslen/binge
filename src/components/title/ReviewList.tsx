'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Heart, MessageCircle, Send, X } from 'lucide-react';
import { useReviewsForTitle, useReviewActions } from '@/hooks/useReviews';
import { useReviewLikes, useReviewComments } from '@/hooks/useReviewSocial';
import { useBlockedUsers } from '@/hooks/useBlockedUsers';
import { useAuth } from '@/hooks/useAuth';
import { UgcActionsMenu } from '@/components/moderation/UgcActionsMenu';
import { JsonLd, reviewSchema } from './JsonLd';
import type { MediaType, Review } from '@/types';

interface ReviewListProps {
  tmdbId: number;
  mediaType: MediaType;
  title?: string;
  posterPath?: string | null;
}

export default function ReviewList({ tmdbId, mediaType, title, posterPath }: ReviewListProps) {
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useReviewsForTitle(tmdbId);
  const reviews = data?.pages.flatMap(p => p.reviews);
  const { submitReview, deleteReview } = useReviewActions();
  const { uid } = useAuth();
  const { isBlocked } = useBlockedUsers();
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
  // Filtrera bort blockerade användare från andra recensioner — min egen
  // recension visas alltid oavsett vad.
  const otherReviews = reviews.filter(r => r.uid !== uid && !isBlocked(r.uid));

  const itemType = mediaType === 'tv' ? 'TVSeries' : 'Movie';
  const itemUrl = `https://binge.nu/${mediaType === 'tv' ? 'tv' : 'movie'}/${tmdbId}/`;
  const ldReviews = [myReview, ...otherReviews].filter(
    (r): r is Review => !!r && !r.spoiler && r.text.trim().length > 0,
  );

  const handleSubmit = async () => {
    if (!text.trim()) return;
    const titleMeta = title ? { title, posterPath: posterPath ?? null } : undefined;
    await submitReview(tmdbId, mediaType, text.trim(), spoiler, null, myReview?.id, titleMeta);
    setText('');
    setSpoiler(false);
    setShowForm(false);
  };

  return (
    <div className="mb-4">
      {title && ldReviews.map(r => (
        <JsonLd key={`ld-${r.id}`} data={reviewSchema({
          id: r.id, authorName: r.displayName, reviewBody: r.text, rating: r.rating,
          itemName: title, itemType, itemUrl,
        })} />
      ))}
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
            placeholder="Skriv din recension…"
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

      {hasNextPage && (
        <button
          type="button"
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
          className="btn btn-ghost"
        >
          {isFetchingNextPage ? 'Laddar…' : 'Visa fler recensioner'}
        </button>
      )}

      {reviews.length === 0 && !showForm && (
        <p className="text-xs text-text-muted">Inga recensioner ännu.</p>
      )}
    </div>
  );
}

function ReviewCard({ review, isOwn, onDelete }: { review: Review; isOwn?: boolean; onDelete?: () => void }) {
  const [revealed, setRevealed] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const { uid } = useAuth();
  const { likeCount, iLike, toggle } = useReviewLikes(review.id);
  const { comments } = useReviewComments(showComments ? review.id : null);

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
        <div className="flex items-center gap-1">
          {isOwn && onDelete && (
            <button onClick={onDelete} className="text-xxs text-danger-ink bg-transparent border-none cursor-pointer font-[inherit]">Ta bort</button>
          )}
          {!isOwn && (
            <UgcActionsMenu
              targetType="review"
              targetId={review.id}
              targetOwnerUid={review.uid}
              targetOwnerName={review.displayName}
            />
          )}
        </div>
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

      <div className="flex items-center gap-3 mt-[6px] pt-[5px] border-t border-border-light">
        <button
          onClick={toggle}
          disabled={!uid}
          className={`inline-flex items-center gap-[4px] bg-transparent border-none cursor-pointer p-0 font-[inherit] text-xxs ${
            iLike ? 'text-accent' : 'text-text-muted hover:text-text-secondary'
          } disabled:opacity-50 disabled:cursor-default`}
          title={uid ? (iLike ? 'Ångra gillning' : 'Gilla') : 'Logga in för att gilla'}
          aria-label={uid ? (iLike ? `Ångra gillning${likeCount > 0 ? ` (${likeCount} gillar)` : ''}` : `Gilla${likeCount > 0 ? ` (${likeCount} gillar)` : ''}`) : 'Logga in för att gilla'}
          aria-pressed={iLike}
        >
          <Heart size={11} fill={iLike ? 'currentColor' : 'none'} aria-hidden="true" />
          {likeCount > 0 && <span>{likeCount}</span>}
        </button>
        <button
          onClick={() => setShowComments(v => !v)}
          className="inline-flex items-center gap-[4px] bg-transparent border-none cursor-pointer p-0 font-[inherit] text-xxs text-text-muted hover:text-text-secondary"
        >
          <MessageCircle size={11} />
          Kommentera
        </button>
      </div>

      {showComments && (
        <ReviewComments
          reviewId={review.id}
          reviewAuthorUid={review.uid}
          comments={comments}
          onClose={() => setShowComments(false)}
        />
      )}
    </div>
  );
}

function ReviewComments({
  reviewId, reviewAuthorUid, comments, onClose,
}: {
  reviewId: string;
  reviewAuthorUid: string;
  comments: import('@/types').ReviewComment[];
  onClose: () => void;
}) {
  const { uid } = useAuth();
  const { addComment, deleteComment } = useReviewComments(reviewId);
  const { isBlocked } = useBlockedUsers();
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);

  // Filtrera bort kommentarer från blockerade användare.
  const visibleComments = comments.filter(c => !isBlocked(c.uid));

  const submit = async () => {
    if (!text.trim()) return;
    setPosting(true);
    try {
      await addComment(text);
      setText('');
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="mt-2 pt-2 border-t border-border-light">
      {visibleComments.length === 0 ? (
        <div className="text-xxs text-text-muted italic">Inga kommentarer än.</div>
      ) : (
        <ul className="space-y-[4px] mb-2">
          {visibleComments.map(c => {
            const canDelete = !!uid && (c.uid === uid || reviewAuthorUid === uid);
            return (
              <li key={c.id} className="text-xxs flex items-start gap-2">
                <div className="flex-1">
                  {c.username ? (
                    <Link href={`/user/${c.username}/`} className="font-semibold text-text-primary no-underline hover:text-accent">
                      {c.displayName}
                    </Link>
                  ) : (
                    <span className="font-semibold text-text-primary">{c.displayName}</span>
                  )}
                  <span className="text-text-secondary ml-[4px]">{c.text}</span>
                  <span className="text-text-muted ml-[4px]">· {c.createdAt.toLocaleDateString('sv-SE')}</span>
                </div>
                {canDelete ? (
                  <button
                    onClick={() => deleteComment(c.id)}
                    className="text-text-muted hover:text-danger-ink bg-transparent border-none cursor-pointer p-0"
                    title="Ta bort"
                    aria-label="Ta bort kommentar"
                  >
                    <X size={10} />
                  </button>
                ) : (
                  <UgcActionsMenu
                    targetType="comment"
                    targetId={`reviews/${reviewId}/comments/${c.id}`}
                    targetOwnerUid={c.uid}
                    targetOwnerName={c.displayName}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {uid ? (
        <div className="flex gap-1">
          <input
            type="text"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void submit(); }}
            placeholder="Skriv en kommentar…"
            maxLength={500}
            className="flex-1 px-2 py-1 text-xxs border border-border-main rounded-sm bg-white"
          />
          <button
            onClick={submit}
            disabled={posting || !text.trim()}
            className="px-2 py-1 bg-accent text-white rounded-sm text-xxs cursor-pointer disabled:opacity-50"
          >
            <Send size={10} />
          </button>
          <button
            onClick={onClose}
            className="px-2 py-1 border border-border-main rounded-sm text-xxs bg-white cursor-pointer text-text-muted"
          >
            Stäng
          </button>
        </div>
      ) : (
        <div className="text-xxs text-text-muted">Logga in för att kommentera.</div>
      )}
    </div>
  );
}
