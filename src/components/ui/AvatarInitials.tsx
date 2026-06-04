/**
 * Initials fallback for a person with no portrait. Pure derivation kept
 * separate from the component so it can be unit-tested without rendering.
 */
export function deriveInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words.slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

export function AvatarInitials({ name, size = 72 }: { name: string; size?: number }) {
  return (
    <div
      role="img"
      aria-label={name}
      style={{
        width: '100%', height: '100%', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: 'var(--placeholder-fill)', color: 'var(--ink-3)',
        fontWeight: 600, fontSize: Math.round(size * 0.2),
      }}
    >
      {deriveInitials(name)}
    </div>
  );
}
