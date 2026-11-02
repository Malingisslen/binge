import test from 'node:test';
import assert from 'node:assert/strict';
import { backoffMs, articleUrl, htmlToText } from './wiki-fetch.helpers.mjs';

test('Retry-After wins over exponential backoff', () => {
  assert.equal(backoffMs(1, '7'), 7500);
  assert.equal(backoffMs(1, '9999'), 60500);
});
test('falls back to exponential backoff, capped', () => {
  assert.equal(backoffMs(1, null), 2000);
  assert.equal(backoffMs(3, undefined), 8000);
  assert.equal(backoffMs(10, 'junk'), 60000);
});
test('articleUrl encodes the title', () => {
  assert.equal(articleUrl('Reacher (TV series)'), 'https://en.wikipedia.org/api/rest_v1/page/html/Reacher_(TV_series)');
});
test('htmlToText strips tags and footnote markers', () => {
  assert.equal(htmlToText('<p>A<sup>[1]</sup> &amp; B</p><script>x</script>'), 'A & B');
});

import { claimSlot } from './wiki-fetch.helpers.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('simultaneous claimers get distinct, gap-spaced slots', async () => {
  const stamp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wf-')), 'stamp');
  const waits = await Promise.all([1, 2, 3, 4, 5].map(() => claimSlot(stamp, 1000)));
  const sorted = [...waits].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i] - sorted[i - 1] >= 900, `gap ${sorted[i] - sorted[i - 1]}`);
});

// In one process claimSlot's critical section has no await, so it runs atomically whether or not
// the lock exists; only separate processes can contend for it. The child's slow clock widens the
// read-to-write window so an absent lock reliably hands several children the same slot.
test('claimers in separate processes get distinct, gap-spaced slots', async () => {
  const { spawn } = await import('node:child_process');
  const helpers = new URL('./wiki-fetch.helpers.mjs', import.meta.url).href;
  const stamp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wf-')), 'stamp');
  const startAt = Date.now() + 1500;
  const childSrc = `
    import { claimSlot } from ${JSON.stringify(helpers)};
    const slow = () => { const t = Date.now(); while (Date.now() - t < 60); return Date.now(); };
    while (Date.now() < ${startAt});
    const wait = await claimSlot(${JSON.stringify(stamp)}, 1000, slow);
    console.log(Date.now() + wait);`;
  const run = () => new Promise((resolve, reject) => {
    const c = spawn(process.execPath, ['--input-type=module', '-e', childSrc], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.on('error', reject);
    c.on('close', (code) => (code === 0 ? resolve(Number(out.trim())) : reject(new Error(`child exit ${code}`))));
  });
  const slots = (await Promise.all([1, 2, 3, 4, 5].map(run))).sort((a, b) => a - b);
  assert.equal(slots.length, 5);
  for (let i = 1; i < slots.length; i++) assert.ok(slots[i] - slots[i - 1] >= 800, `gap ${slots[i] - slots[i - 1]}`);
});
