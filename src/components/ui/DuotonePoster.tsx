import type { Duotone } from '@/lib/duotone';

// Poster wrapper that applies a duotone tone to the inner <img>. Use for
// identification surfaces (lists, library grids, calendar cards, similar
// shows). For preview content (episode stills, trailer, cast portraits),
// render raw <img> without this wrapper — see RawImage.

type Ratio = '2/3' | '16/9' | '1/1' | '21/9';

export default function DuotonePoster({
  src,
  alt,
  tone,
  ratio = '2/3',
  width,
  height,
  className,
  loading = 'lazy',
}: {
  src: string;
  alt: string;
  tone: Duotone;
  ratio?: Ratio;
  width?: number;
  height?: number;
  className?: string;
  loading?: 'lazy' | 'eager';
}) {
  return (
    <div
      className={`poster duo-${tone}${className ? ` ${className}` : ''}`}
      style={{ aspectRatio: ratio.replace('/', ' / ') }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading={loading}
        decoding="async"
      />
    </div>
  );
}
