// Renders the eight SVG <filter> definitions used by the duotone treatment.
// Mount once at the app root (AppShell). Any <img> with
// `filter: url(#duo-<tone>)` will pick these up — see direction-h.css filter
// values, mirrored here. Each filter does a luminance pass via feColorMatrix,
// then maps black→shadow + white→highlight via feComponentTransfer.

export default function DuotoneFilters() {
  return (
    <svg
      width="0"
      height="0"
      style={{ position: 'absolute', left: -9999, pointerEvents: 'none' }}
      aria-hidden="true"
    >
      <defs>
        <filter id="duo-terra" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0 0 0 1 0" />
          <feComponentTransfer>
            <feFuncR type="table" tableValues="0.13 0.94" />
            <feFuncG type="table" tableValues="0.09 0.84" />
            <feFuncB type="table" tableValues="0.08 0.78" />
          </feComponentTransfer>
        </filter>
        <filter id="duo-slate" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0 0 0 1 0" />
          <feComponentTransfer>
            <feFuncR type="table" tableValues="0.08 0.82" />
            <feFuncG type="table" tableValues="0.11 0.88" />
            <feFuncB type="table" tableValues="0.18 0.95" />
          </feComponentTransfer>
        </filter>
        <filter id="duo-moss" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0 0 0 1 0" />
          <feComponentTransfer>
            <feFuncR type="table" tableValues="0.09 0.84" />
            <feFuncG type="table" tableValues="0.15 0.92" />
            <feFuncB type="table" tableValues="0.10 0.82" />
          </feComponentTransfer>
        </filter>
        <filter id="duo-clay" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0 0 0 1 0" />
          <feComponentTransfer>
            <feFuncR type="table" tableValues="0.17 0.96" />
            <feFuncG type="table" tableValues="0.13 0.88" />
            <feFuncB type="table" tableValues="0.07 0.76" />
          </feComponentTransfer>
        </filter>
        <filter id="duo-plum" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0 0 0 1 0" />
          <feComponentTransfer>
            <feFuncR type="table" tableValues="0.16 0.86" />
            <feFuncG type="table" tableValues="0.10 0.78" />
            <feFuncB type="table" tableValues="0.20 0.90" />
          </feComponentTransfer>
        </filter>
        <filter id="duo-steel" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0 0 0 1 0" />
          <feComponentTransfer>
            <feFuncR type="table" tableValues="0.06 0.78" />
            <feFuncG type="table" tableValues="0.12 0.90" />
            <feFuncB type="table" tableValues="0.14 0.92" />
          </feComponentTransfer>
        </filter>
        <filter id="duo-olive" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0 0 0 1 0" />
          <feComponentTransfer>
            <feFuncR type="table" tableValues="0.13 0.86" />
            <feFuncG type="table" tableValues="0.15 0.90" />
            <feFuncB type="table" tableValues="0.08 0.78" />
          </feComponentTransfer>
        </filter>
        <filter id="duo-oxblood" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0 0 0 1 0" />
          <feComponentTransfer>
            <feFuncR type="table" tableValues="0.20 0.88" />
            <feFuncG type="table" tableValues="0.07 0.78" />
            <feFuncB type="table" tableValues="0.06 0.74" />
          </feComponentTransfer>
        </filter>
      </defs>
    </svg>
  );
}
