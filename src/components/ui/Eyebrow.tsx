import type { ElementType, ReactNode } from 'react';

// The small uppercase label above a section, a figure or a field ("ögonbrynet").
// Table header cells are not eyebrows and keep their own classes.
const SIZE = {
  xxs: 'text-xxs font-semibold',
  xs: 'text-xs font-bold',
} as const;

export function eyebrowClass(size: keyof typeof SIZE = 'xxs', className?: string): string {
  return ['uppercase tracking-[0.5px] text-ink-3', SIZE[size], className].filter(Boolean).join(' ');
}

export function Eyebrow({
  as: Tag = 'div', size = 'xxs', className, id, children,
}: {
  as?: ElementType;
  size?: keyof typeof SIZE;
  className?: string;
  id?: string;
  children: ReactNode;
}) {
  return <Tag id={id} className={eyebrowClass(size, className)}>{children}</Tag>;
}
