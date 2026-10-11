import { mediaTypeDocId } from '@/lib/mediaTypeDocId';
import type { MediaType } from '@/types';

// The caps firestore.rules enforces on a tip; the client trims to them so a long title
// or note is shortened instead of refused.
export const TIP_TITLE_MAX = 200;
export const TIP_NOTE_MAX = 140;

// One doc per sender and title, so tipping the same friend about the same title again
// overwrites the earlier tip. firestore.rules binds the id to exactly this form.
export function tipDocId(senderUid: string, mediaType: MediaType, tmdbId: number): string {
  return `${senderUid}_${mediaTypeDocId(mediaType, tmdbId)}`;
}

export interface TipPayloadInput {
  fromUid: string;
  mediaType: MediaType;
  tmdbId: number;
  title: string;
  note: string;
}

// The fields of a tip document, without `createdAt` (the write adds the server time).
// An empty note is left out rather than stored, since the rules accept the key only as
// a string.
export function buildTipFields(input: TipPayloadInput): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    fromUid: input.fromUid,
    mediaType: input.mediaType,
    tmdbId: input.tmdbId,
    title: input.title.trim().slice(0, TIP_TITLE_MAX),
  };
  const note = input.note.trim().slice(0, TIP_NOTE_MAX);
  if (note) fields.note = note;
  return fields;
}

export interface Tip {
  id: string;
  fromUid: string;
  mediaType: MediaType;
  tmdbId: number;
  title: string;
  note: string | null;
  createdAt: Date;
}

// Reads one stored tip. A doc that does not have the shape the rules write is skipped
// rather than rendered as a broken row.
export function parseTip(id: string, data: Record<string, unknown>): Tip | null {
  const { fromUid, mediaType, tmdbId, title, note, createdAt } = data;
  if (typeof fromUid !== 'string' || !fromUid) return null;
  if (mediaType !== 'movie' && mediaType !== 'tv') return null;
  if (typeof tmdbId !== 'number' || !Number.isInteger(tmdbId) || tmdbId <= 0) return null;
  if (typeof title !== 'string' || !title) return null;
  const toDate = (createdAt as { toDate?: () => Date } | null | undefined)?.toDate;
  return {
    id,
    fromUid,
    mediaType,
    tmdbId,
    title,
    note: typeof note === 'string' && note ? note : null,
    createdAt: typeof toDate === 'function' ? toDate.call(createdAt) : new Date(0),
  };
}

export function titleHref(mediaType: MediaType, tmdbId: number): string {
  return `/${mediaType === 'movie' ? 'movie' : 'tv'}/${tmdbId}/`;
}
