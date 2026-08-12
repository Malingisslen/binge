#!/usr/bin/env node
/**
 * Dispatcher to the SHARED worktree/toolchain guards (BIN-822 / BIN-837).
 *
 *   node scripts/shared-guard.mjs check-toolchain          # npm run preflight
 *   node scripts/shared-guard.mjs worktree-cleanup --audit # list rigs carrying a junction
 *   node scripts/shared-guard.mjs worktree-cleanup <rig>   # junction-safe teardown
 *
 * The guards themselves live in the workflow-guards plugin (C:/claude-plugins), because
 * all three repos run review agents that build isolated rigs the same way and the version
 * first built here on 2026-08-09 protected this repo alone. This file is a POINTER, not a
 * copy: no guard logic may be added below, or the three repos start drifting again — which
 * is the entire ticket.
 *
 * WHY IT FAILS OPEN. Every gate-class hook in that plugin fails CLOSED, and this one
 * deliberately does not. It runs as an npm `pre*` step in front of lint/typecheck/test, so
 * failing closed on an unresolvable plugin path would break every one of those commands in
 * every repo at once — strictly worse than the bug being guarded against. Failing open
 * costs exactly what we have today: the cryptic `'tsc' is not recognized`. It is a
 * preflight that improves an error message, never a permission to commit.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PLUGIN = 'workflow-guards@malin-plugins';
const MARKETPLACE = 'malin-plugins';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const sameDir = (a, b) => a.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
  === b.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Every place the plugin's scripts/ could be, best first.
 *
 * The installed copy comes first — preferring the one pinned for THIS repo, since that is
 * the version the repo's own hooks are running, so CLI and hooks stay in step. The
 * marketplace checkout is the fallback, discovered rather than hardcoded because it moves
 * and a stale absolute path here would silently disable the preflight in every repo.
 */
function guardScriptDirs() {
  const dirs = [];
  if (process.env.WORKTREE_GUARD_ROOT) dirs.push(join(process.env.WORKTREE_GUARD_ROOT, 'scripts'));

  const installs = readJson(join(homedir(), '.claude', 'plugins', 'installed_plugins.json'))
    ?.plugins?.[PLUGIN] ?? [];
  const mine = installs.find((i) => i.projectPath && sameDir(i.projectPath, REPO_ROOT));
  for (const install of [mine, ...installs]) {
    if (install?.installPath) dirs.push(join(install.installPath, 'scripts'));
  }

  const location = readJson(join(homedir(), '.claude', 'plugins', 'known_marketplaces.json'))
    ?.[MARKETPLACE]?.installLocation;
  if (location) dirs.push(join(location, 'plugins', 'workflow-guards', 'scripts'));
  return dirs;
}

/**
 * Resolve the SCRIPT, not the directory. Installs are sha-pinned per repo, so between a
 * commit here and `node tools/fanout-update.mjs` the pinned copy exists but predates the
 * guard — stopping at the first existing DIRECTORY would report the guard as missing while
 * a perfectly good copy sat one candidate further down.
 */
function resolveGuardScript(name) {
  for (const dir of guardScriptDirs()) {
    const script = join(dir, `${name}.mjs`);
    if (existsSync(script)) return script;
  }
  return '';
}

const [name, ...rest] = process.argv.slice(2);
if (!name) {
  process.stderr.write('usage: node scripts/shared-guard.mjs <check-toolchain|worktree-cleanup> [args]\n');
  process.exit(2);
}

const script = resolveGuardScript(name);
if (!script) {
  process.stderr.write(
    `[shared-guard] Hittar inte den delade ${name}-kontrollen (workflow-guards-pluginet).\n` +
    '  Förkontrollen hoppas över — inget är trasigt av det här, felmeddelanden blir bara sämre.\n' +
    '  Installera om pluginet, eller peka ut det med WORKTREE_GUARD_ROOT.\n'
  );
  process.exit(0);
}

const mod = await import(pathToFileURL(script).href);
process.exit(await mod.main(rest, process.cwd()));
