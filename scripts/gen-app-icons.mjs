// One logo everywhere (plan round 2, Malin's choice B, 2026-10-06): the saffron tile
// with the geometric "b". This script draws every brand file from that one mark:
// app icons, the tab favicon, the apple icon and the share images.
//
// Run: npm i --no-save playwright-core && CHROME=<chromium binary> node scripts/gen-app-icons.mjs
// Chromium renders the share images so they get Albert Sans (fetched from Google
// Fonts at run time, the same face the site loads).
import { writeFileSync } from 'node:fs';
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

const BRAND_TILE = oklchToHex(0.72, 0.14, 75);    // --acc
const BRAND_GLYPH = oklchToHex(0.985, 0.003, 90); // --bg
const HERO_BG = oklchToHex(0.18, 0.006, 80);      // --hero-bg
const HERO_INK = BRAND_GLYPH;
const HERO_INK_2 = oklchToHex(0.78, 0.006, 85);   // dark-mode --ink-2

function markSvg({ radius }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="${radius}" fill="${BRAND_TILE}"/><rect x="168" y="104" width="52" height="308" rx="12" fill="${BRAND_GLYPH}"/><circle cx="266" cy="316" r="72" fill="none" stroke="${BRAND_GLYPH}" stroke-width="52"/></svg>`;
}

const SHARES = [
  { file: 'public/og-image.png', headline: 'Se vad du betalar för streaming, och vad du kan pausa.', sub: 'Binge håller koll på dina serier och säger till när en tjänst inte används, med svenska priser.' },
  // Keep these in step with src/lib/seo/shareShells.ts (title without " — Binge", description).
  { file: 'public/og/tillsammans.png', headline: 'Välj vad ni ska se', sub: 'Du är inbjuden att välja tillsammans. Svep ja eller nej på förslagen. Inget konto behövs.' },
  { file: 'public/og/grupper.png', headline: 'Inbjudan till en grupp', sub: 'Gå med i gruppen och se vad ni kan streama tillsammans.' },
  { file: 'public/og/lista.png', headline: 'En lista på Binge', sub: 'Film och serier, och var de går att streama i Sverige.' },
  { file: 'public/og/profil.png', headline: 'En profil på Binge', sub: 'Vad som tittas på, vill ses och har betygsatts på Binge.' },
];

// App icons: full-bleed tile (iOS/Android round it), the "b" sits in the maskable safe zone.
for (const { file, size } of [
  { file: 'public/icon-192.png', size: 192 },
  { file: 'public/icon-512.png', size: 512 },
  { file: 'public/icon-maskable-512.png', size: 512 },
  { file: 'public/apple-touch-icon.png', size: 180 },
  { file: 'src/app/apple-icon.png', size: 180 },
]) {
  await sharp(Buffer.from(markSvg({ radius: 0 }))).resize(size, size).png().toFile(file);
  console.log(`wrote ${file}`);
}
// The tab favicon keeps a rounded tile, since browsers show it as is.
writeFileSync('src/app/icon.svg', markSvg({ radius: 96 }) + '\n');
console.log('wrote src/app/icon.svg');
// Push notifications use this file as their icon (functions/src/push.ts).
writeFileSync('public/og-image.svg', markSvg({ radius: 96 }) + '\n');
console.log('wrote public/og-image.svg');

function shareHtml({ headline, sub }) {
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Albert+Sans:wght@400;800&display=block">
<style>
  html,body{margin:0;width:1200px;height:630px;background:${HERO_BG};font-family:'Albert Sans',sans-serif}
  .wrap{box-sizing:border-box;height:100%;padding:72px 80px;display:flex;flex-direction:column;justify-content:space-between}
  .brand{display:flex;align-items:center;gap:20px;color:${HERO_INK};font-weight:800;font-size:48px;letter-spacing:-0.04em}
  .brand svg{width:64px;height:64px}
  h1{margin:0;color:${HERO_INK};font-weight:800;font-size:76px;line-height:1.06;letter-spacing:-0.02em;max-width:1000px}
  p{margin:20px 0 0;color:${HERO_INK_2};font-size:32px;line-height:1.35;max-width:980px}
</style></head><body><div class="wrap">
  <div class="brand">${markSvg({ radius: 96 })}binge.nu</div>
  <div><h1>${headline}</h1><p>${sub}</p></div>
</div></body></html>`;
}

const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const share of SHARES) {
  await page.setContent(shareHtml(share), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ type: 'png' });
  await sharp(png).png({ compressionLevel: 9, palette: true }).toFile(share.file);
  console.log(`wrote ${share.file}`);
}
await browser.close();
console.log(`tile ${BRAND_TILE}, glyph ${BRAND_GLYPH}`);
