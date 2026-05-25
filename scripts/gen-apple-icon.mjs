// One-off: rasterise src/app/icon.svg to src/app/apple-icon.png (180×180).
// Re-run if the icon design changes.
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve('src/app/icon.svg');
const OUT = resolve('src/app/apple-icon.png');

const svg = readFileSync(SRC);
await sharp(svg, { density: 1024 })
  .resize(180, 180, { fit: 'cover' })
  .png()
  .toFile(OUT);

console.log(`✓ ${OUT}`);
