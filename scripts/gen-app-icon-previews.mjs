// One-off: render the 3 candidate app-icon directions (A/B/C) to PNG so they
// can be judged as real artifacts. The lowercase "b" is built from vector
// primitives (stem rect + bowl ring) — Albert Sans is a geometric sans, so a
// clean geometric b reads as on-brand without needing the font at raster time.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

// --- oklch → sRGB hex (Björn Ottosson) so the icons match globals.css tokens exactly.
function oklchToHex(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const lr = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  const g = (c) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(v * 255)));
  };
  return '#' + [lr, lg, lb].map(g).map((n) => n.toString(16).padStart(2, '0')).join('');
}

const ACC = oklchToHex(0.72, 0.14, 75);       // saffron
const ACC_DEEP = oklchToHex(0.55, 0.13, 70);  // deep saffron
const BG = oklchToHex(0.985, 0.003, 90);      // warm off-white
const INK = oklchToHex(0.17, 0.006, 80);      // warm near-black
const RULE = oklchToHex(0.88, 0.006, 80);     // hairline
console.log({ ACC, ACC_DEEP, BG, INK, RULE });

// Geometric lowercase "b": tall stem + circular bowl ring (same stroke weight).
function glyphB(color) {
  return `
    <rect x="168" y="104" width="52" height="308" rx="12" fill="${color}"/>
    <circle cx="266" cy="316" r="72" fill="none" stroke="${color}" stroke-width="52"/>`;
}

// rounded=true → iOS-style squircle preview; rounded=false → full-bleed (maskable).
function tile({ bg, fg, rounded = true, border = null, square = null }) {
  const rx = rounded ? 114 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <rect x="0" y="0" width="512" height="512" rx="${rx}" fill="${bg}"${border ? ` stroke="${border}" stroke-width="4"` : ''}/>
    ${glyphB(fg)}
    ${square ? `<rect x="372" y="120" width="46" height="46" rx="9" fill="${square}"/>` : ''}
  </svg>`;
}

const options = {
  A: tile({ bg: ACC, fg: BG }),
  B: tile({ bg: INK, fg: ACC }),
  C: tile({ bg: BG, fg: ACC_DEEP, border: RULE, square: ACC }),
};

mkdirSync('.icon-preview', { recursive: true });
for (const [k, svg] of Object.entries(options)) {
  await sharp(Buffer.from(svg)).png().toFile(`.icon-preview/${k}.png`);
  console.log(`wrote .icon-preview/${k}.png`);
}
