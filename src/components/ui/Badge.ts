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

// A small outlined tag in sentence case: a streaming service on a card, a private
// list tag, a participant. Lighter than a badge, which shouts in uppercase.
const TAG_TONE = {
  muted: 'border-rule text-ink-3',
  ink: 'border-rule text-ink-2',
  acc: 'border-acc-deep text-acc-deep',
  faint: 'border-rule-2 text-ink-3',
} as const;

export function tagClass(tone: keyof typeof TAG_TONE = 'muted', className?: string): string {
  return ['inline-flex items-center gap-1 rounded-sm border px-1 py-px text-xxs', TAG_TONE[tone], className]
    .filter(Boolean).join(' ');
}
