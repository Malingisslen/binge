// The panel every list, form and summary sits in: surface, rule border, 3px corners.
// Padding, layout and overflow stay at the call site.
export function cardClass(className?: string): string {
  return ['bg-surface border border-rule rounded-sm', className].filter(Boolean).join(' ');
}
