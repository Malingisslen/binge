import type { ElementType, ReactNode } from 'react';

// The small uppercase label above a section, a figure, a field or a table column
// ("ögonbrynet"). One letter-spacing and one weight per size, so every eyebrow on the
// site reads the same. Where the element needs its own props (label, summary, th),
// put eyebrowClass() on it instead of the component.
const SIZE = {
  micro: 'text-micro font-semibold',
  xxs: 'text-xxs font-semibold',
  xs: 'text-xs font-bold',
} as const;

const TONE = {
  muted: 'text-ink-3',
  ink: 'text-ink',
  acc: 'text-acc-deep',
  danger: 'text-danger-ink',
  onAcc: 'text-on-acc',
} as const;

export type EyebrowSize = keyof typeof SIZE;
export type EyebrowTone = keyof typeof TONE;

export function eyebrowClass(
  { size = 'xxs', tone = 'muted', className }: { size?: EyebrowSize; tone?: EyebrowTone; className?: string } = {},
): string {
  return ['uppercase tracking-[0.5px]', TONE[tone], SIZE[size], className].filter(Boolean).join(' ');
}

export function Eyebrow({
  as: Tag = 'div', size, tone, className, id, children,
}: {
  as?: ElementType;
  size?: EyebrowSize;
  tone?: EyebrowTone;
  className?: string;
  id?: string;
  children: ReactNode;
}) {
  return <Tag id={id} className={eyebrowClass({ size, tone, className })}>{children}</Tag>;
}
