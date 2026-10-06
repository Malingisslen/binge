// The Binge logo mark: the saffron tile with the geometric "b" (Malin's choice B,
// plan round 2, 2026-10-06). The app icon, favicon and share images are drawn
// from the same shapes by scripts/gen-app-icons.mjs.
export default function BrandMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={['brand-mark', className].filter(Boolean).join(' ')}
    >
      <rect width="512" height="512" rx="96" fill="var(--acc)" />
      <rect x="168" y="104" width="52" height="308" rx="12" fill="var(--brand-glyph)" />
      <circle cx="266" cy="316" r="72" fill="none" stroke="var(--brand-glyph)" strokeWidth="52" />
    </svg>
  );
}
