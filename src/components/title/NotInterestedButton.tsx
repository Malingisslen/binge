'use client';

import { X, Undo2 } from 'lucide-react';
import { useNotInterested } from '@/hooks/useNotInterested';
import { useToast } from '@/contexts/ToastContext';
import type { MediaType } from '@/types';

interface NotInterestedButtonProps {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  variant?: 'icon' | 'full';
}

export default function NotInterestedButton({ tmdbId, mediaType, title, variant = 'full' }: NotInterestedButtonProps) {
  const { has, add, remove } = useNotInterested();
  const { show: toast } = useToast();
  const marked = has(tmdbId);

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (marked) {
      remove(tmdbId);
      toast(`${title} — visas i rekommendationer igen`);
    } else {
      add(tmdbId, mediaType);
      toast(`${title} — visas inte igen`);
    }
  }

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={handleClick}
        title={marked ? 'Visa i rekommendationer igen' : 'Inte intresserad'}
        aria-label={marked ? 'Visa i rekommendationer igen' : 'Inte intresserad'}
        className={`flex items-center justify-center w-5 h-5 rounded-sm border cursor-pointer ${
          marked
            ? 'bg-accent text-white border-accent'
            : 'bg-black/65 text-white border-black/30 hover:bg-black/80'
        }`}
      >
        {marked ? <Undo2 size={11} /> : <X size={12} />}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`inline-flex items-center gap-[5px] px-[10px] py-[3px] border rounded-sm text-xs font-[inherit] cursor-pointer font-semibold ${
        marked
          ? 'bg-surface border-border-main text-text-primary hover:bg-surface-hover'
          : 'bg-surface border-border-main text-text-secondary hover:bg-surface-hover'
      }`}
    >
      {marked ? <Undo2 size={11} /> : <X size={11} />}
      {marked ? 'Visa igen' : 'Inte intresserad'}
    </button>
  );
}
