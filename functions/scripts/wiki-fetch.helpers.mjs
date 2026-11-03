// Wikipedia rate-limits the shared cloud egress IP hard (429 + Retry-After), so every
// recap fetch goes through one spaced, retrying path instead of ad-hoc WebFetch calls.

export const USER_AGENT = 'BingeRecapBot/1.0 (https://binge.nu; recap research)';
export const MIN_GAP_MS = 2500;
export const MAX_ATTEMPTS = 6;

/** Wait time before retry `attempt` (1-based): honours Retry-After, else 2s,4s,8s... capped at 60s. */
export function backoffMs(attempt, retryAfterHeader) {
  const secs = Number.parseInt(retryAfterHeader ?? '', 10);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs, 60) * 1000 + 500;
  return Math.min(2 ** attempt * 1000, 60000);
}

export function articleUrl(title, lang = 'en') {
  return `https://${lang}.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

/** Reduces REST HTML to readable text; drops scripts, styles, tables of references. */
export function htmlToText(html) {
  return html
    .replace(/<(script|style|sup)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|h[1-6]|li|tr|div)>/gi, '\n')
    .replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

import fs from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Claims the next free request slot and returns how long the caller must wait for it.
 * The read-modify-write of the stamp is serialised by an exclusive lock file; without it,
 * agents started together all read the same stamp and fire at once.
 */
export async function claimSlot(stampPath, gapMs = MIN_GAP_MS, now = Date.now) {
  const lockPath = `${stampPath}.lock`;
  for (;;) {
    try {
      fs.closeSync(fs.openSync(lockPath, 'wx'));
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        // A crashed holder must not block everyone forever.
        if (now() - fs.statSync(lockPath).mtimeMs > 5000) fs.rmSync(lockPath, { force: true });
      } catch { /* lock vanished: retry */ }
      await sleep(30);
    }
  }
  try {
    let last = 0;
    try { last = Number(fs.readFileSync(stampPath, 'utf8')) || 0; } catch { /* first call */ }
    const slot = Math.max(now(), last + gapMs);
    fs.writeFileSync(stampPath, String(slot));
    return Math.max(0, slot - now());
  } finally {
    fs.rmSync(lockPath, { force: true });
  }
}
