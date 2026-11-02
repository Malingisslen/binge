// Usage: node functions/scripts/wiki-fetch.mjs "<Article title>" [lang]
// Prints the article as plain text. Spaced across processes via a lock file so parallel
// per-show agents share one request budget instead of tripping Wikipedia's 429.
// Exit codes: 0 ok, 1 non-retryable HTTP status, 2 usage, 3 not found, 4 still rate-limited.
import os from 'node:os';
import path from 'node:path';
import { USER_AGENT, MAX_ATTEMPTS, backoffMs, articleUrl, htmlToText, claimSlot } from './wiki-fetch.helpers.mjs';

const stampFile = path.join(os.tmpdir(), 'binge-wiki-fetch.stamp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const [title, lang = 'en'] = process.argv.slice(2);
if (!title) { console.error('Usage: wiki-fetch.mjs "<title>" [lang]'); process.exit(2); }

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  await sleep(await claimSlot(stampFile));
  let res;
  try {
    res = await fetch(articleUrl(title, lang), { headers: { 'User-Agent': USER_AGENT } });
  } catch (err) {
    console.error(`network error: ${err.message}, attempt ${attempt}/${MAX_ATTEMPTS}`);
    await sleep(backoffMs(attempt));
    continue;
  }
  if (res.ok) { console.log(htmlToText(await res.text())); process.exit(0); }
  if (res.status === 404) { console.error('NOT_FOUND'); process.exit(3); }
  if (res.status !== 429 && res.status < 500) { console.error(`HTTP ${res.status}`); process.exit(1); }
  console.error(`HTTP ${res.status}, attempt ${attempt}/${MAX_ATTEMPTS}`);
  await sleep(backoffMs(attempt, res.headers.get('retry-after')));
}
console.error('RATE_LIMITED');
process.exit(4);
