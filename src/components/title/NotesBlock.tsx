'use client';

import { useState } from 'react';
import NotesTextarea from './NotesTextarea';

interface NotesBlockProps {
  notes: string | null;
  onChange: (notes: string | null) => void;
}

export default function NotesBlock({ notes, onChange }: NotesBlockProps) {
  const [open, setOpen] = useState(!!notes);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-text-muted bg-transparent border-none cursor-pointer font-[inherit] p-0 mb-2 hover:text-accent"
      >
        + Anteckning
      </button>
    );
  }

  return (
    <div className="mb-3">
      <NotesTextarea value={notes} onChange={onChange} />
    </div>
  );
}
