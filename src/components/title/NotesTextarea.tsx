'use client';

import { useState, useRef, useEffect } from 'react';

interface NotesTextareaProps {
  value: string | null;
  onChange: (notes: string | null) => void;
  className?: string;
}

export default function NotesTextarea({ value, onChange, className }: NotesTextareaProps) {
  const [localValue, setLocalValue] = useState(value ?? '');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalValue(value ?? '');
  }, [value]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const handleChange = (val: string) => {
    setLocalValue(val);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      onChange(val || null);
    }, 500);
  };

  return (
    <textarea
      value={localValue}
      onChange={e => handleChange(e.target.value)}
      placeholder="Anteckning..."
      maxLength={500}
      className={className ?? 'w-full max-w-[400px] h-[60px] px-2 py-1 text-base border border-border-main rounded-sm bg-surface font-[inherit] resize-none outline-none focus:border-accent'}
      rows={2}
    />
  );
}
