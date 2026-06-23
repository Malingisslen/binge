// Generate the production PWA icon set (option A: saffron tile, cream "b").
// Source is a full-bleed square SVG (no baked rounding — iOS/Android apply their
// own mask). The geometric "b" sits inside the maskable safe zone, so the same
// art serves both "any" and "maskable" purposes. Run: node scripts/gen-app-icons.mjs
import sharp from 'sharp';

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

const TILE = oklchToHex(0.72, 0.14, 75);   // --acc saffron
const GLYPH = oklchToHex(0.985, 0.003, 90); // --bg warm off-white

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect x="0" y="0" width="512" height="512" fill="${TILE}"/>
  <rect x="168" y="104" width="52" height="308" rx="12" fill="${GLYPH}"/>
  <circle cx="266" cy="316" r="72" fill="none" stroke="${GLYPH}" stroke-width="52"/>
</svg>`;

const targets = [
  { file: 'public/icon-192.png', size: 192 },
  { file: 'public/icon-512.png', size: 512 },
  { file: 'public/icon-maskable-512.png', size: 512 },
  { file: 'public/apple-touch-icon.png', size: 180 },
];

for (const { file, size } of targets) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(file);
  console.log(`wrote ${file} (${size}px)`);
}
