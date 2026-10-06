import { eyebrowClass } from './Eyebrow';

// A table's column heading: the eyebrow type on the header band. Alignment, horizontal
// padding and responsive visibility stay at the call site.
export function thClass(className?: string): string {
  return eyebrowClass({ className: ['py-1.5 border-b border-rule-2 bg-bg-2', className].filter(Boolean).join(' ') });
}
