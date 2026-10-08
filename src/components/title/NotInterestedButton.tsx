'use client';

import { X, Undo2 } from 'lucide-react';
import { useNotInterested } from '@/hooks/useNotInterested';
import { useToast } from '@/contexts/ToastContext';
import type { MediaType } from '@/types';
import { Button } from '@/components/ui/Button';

interface NotInterestedButtonProps {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  variant?: 'icon' | 'full';
}

export default function NotInterestedButton({ tmdbId, mediaType, title, variant = 'full' }: NotInterestedButtonProps) {
  const { has, add, remove } = useNotInterested();
  const { show: toast } = useToast();
  const marked = has(mediaType, tmdbId);

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (marked) {
      remove(mediaType, tmdbId);
      toast(`${title} — visas i rekommendationer igen`);
    } else {
      add(mediaType, tmdbId);
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
        className={`flex items-center justify-center w-6 h-6 rounded-sm border cursor-pointer ${
          marked
            ? 'bg-acc-deep text-on-acc border-acc-deep'
            : 'bg-black/65 text-white border-black/30 hover:bg-black/80'
        }`}
      >
        {marked ? <Undo2 size={11} /> : <X size={12} />}
      </button>
    );
  }

  return (
    <Button type="button" onClick={handleClick} variant="ghost" size="sm">
      {marked ? <Undo2 size={11} /> : <X size={11} />}
      {marked ? 'Visa igen' : 'Inte intresserad'}
    </Button>
  );
}
