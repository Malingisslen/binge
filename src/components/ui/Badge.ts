// A short uppercase status tag next to a name ("Gratis", "Du är här").
const TONE = {
  acc: 'bg-acc-soft text-acc-deep',
  success: 'border border-season-done text-season-done',
  muted: 'border border-rule bg-bg-2 text-ink-2',
} as const;

export function badgeClass(tone: keyof typeof TONE = 'muted', className?: string): string {
  return ['inline-flex items-center rounded-sm px-1.5 py-px text-xxs font-bold uppercase tracking-[0.5px]', TONE[tone], className]
    .filter(Boolean).join(' ');
}
