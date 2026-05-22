/* eslint-disable */
// Lokal SPA-aware static server som speglar Firebase Hosting:s rewrites för
// Lighthouse-audits. Skickas inte med i deploy — bara för audit:s.
// Mimar firebase.json:
//   - statiska filer i out/ serveras direkt
//   - 404 → fallback till out/_/index.html (samma som ** → /_/index.html)
//   - cache-headers spelar ingen roll lokalt (vi mäter inte CDN)
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(process.argv[2] || 'out');
const PORT = Number(process.env.PORT || 4173);
const FALLBACK = resolve(ROOT, '_/index.html');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

async function tryFile(p) {
  try {
    const s = await stat(p);
    if (s.isDirectory()) return null;
    return p;
  } catch { return null; }
}

async function resolveFile(urlPath) {
  // strip query
  const clean = urlPath.split('?')[0];
  // direct file
  const direct = join(ROOT, clean);
  let f = await tryFile(direct);
  if (f) return f;
  // index.html in directory
  f = await tryFile(join(direct, 'index.html'));
  if (f) return f;
  return null;
}

const server = http.createServer(async (req, res) => {
  const file = await resolveFile(req.url || '/');
  if (file) {
    const buf = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(buf);
    return;
  }
  // SPA fallback (mimics firebase ** → /_/index.html)
  try {
    const buf = await readFile(FALLBACK);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, () => console.log(`SPA server on http://localhost:${PORT} (root: ${ROOT})`));
