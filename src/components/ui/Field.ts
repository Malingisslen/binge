// Text inputs and textareas take .field (globals.css); selects take .select. Width,
// alignment and margins stay at the call site.
export function fieldClass({ size, className }: { size?: 'sm'; className?: string } = {}): string {
  return ['field', size === 'sm' && 'field-sm', className].filter(Boolean).join(' ');
}
