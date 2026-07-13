# BIN-185 recaps — operator runbook (P3)

Spoiler-safe catch-up recaps. The `recaps/{tmdbId}_{s}_{e}` (boundary) and
`recaps/{tmdbId}_season_{n}` (completed-season) caches are public-read / admin-write; the
ONLY writer is the local `/recap` batch below. ADR: `docs/org/adr/0011-bin185-recap-cc-by-sa.md`.

**schemaVersion 2 (2026-07-12, story-so-far redesign):** boundary docs gained an optional
`textFull` field (fuller "this season so far" recap) and the standalone `_season_{n}` doc type
(full recap of a completed season) — plan: `~/.claude/plans/binge-recap-story-so-far-redesign-2026-07-12.md`.
`text` must now be self-contained (a reader remembering nothing since they stopped should follow
it) — v1 docs read as single-episode blurbs instead and are being regenerated (`.claude/skills/recap/SKILL.md`
§Regeneration tracks the backlog).

## 1. One-time: the least-privilege service-account key (Malin, Firebase/GCP console)

Firestore IAM cannot scope write access to a single collection, so "least privilege" here = a **dedicated
service account** (separate from any owner/deploy key) with the minimal Firestore role, and the upload
script self-limits to `recaps/*`.

1. Firebase console → ⚙ **Project settings → Service accounts → Manage service account permissions**
   (opens Google Cloud IAM & Admin).
2. **Service Accounts → Create service account.** Name: `recaps-writer`. 
3. Grant it the role **Cloud Datastore User** (`roles/datastore.user`) — Firestore read/write, nothing else
   (no owner, no editor, no other services).
4. **Keys → Add key → Create new key → JSON.** Download it. Save it OUTSIDE the repo (e.g.
   `C:\Users\malla\.secrets\recaps-writer.json`). **Never commit it** — `.gitignore` already blocks
   `*service-account*.json` / `*-recaps-writer*.json`, but keep it out of the repo entirely.
5. Tell me the absolute path. That's all — the rest is mine to run.

## 2. Generate recaps for a show (Claude, in-session — 0 kr on the Max subscription)

Per show, I:
- Resolve the show + its season/episode list. Show selection priority (no-args `/recap`): (1) the
  schemaVersion regeneration backlog if any is pending, (2) the stored insikter `topTitles` (TV, ranked
  by count), (3) once topTitles has no uncovered TV title left, a TMDB popularity fallback
  (`/discover/tv`, `watch_region=SE`, excludes talk/news/reality/documentary) so coverage keeps growing
  toward "all relevant shows" rather than stalling once the watchlist snapshot is exhausted — see
  `.claude/skills/recap/SKILL.md` for the exact query and skip-list mechanics.
- For **each** boundary `(s,e)`: read **per-episode** summaries for episodes **≤ (s,e)** from Wikipedia and
  other **CC BY-SA-compatible** wikis (verify each source's licence footer; SKIP all-rights-reserved). Stay
  strictly on episode-specific pages ≤ the boundary — never character/overall-plot pages (they span the
  whole series → spoilers).
- Write an original Swedish `sammanfattning` — **paraphrase, never copy verbatim phrasing or track a
  source's structure** (Legal). Record every source in `sources[]`. Per boundary, write BOTH `text`
  (short, self-contained "story so far") and `textFull` (fuller season-so-far) from the same source
  read. After a season's boundaries are done, also write its `_season_{n}` doc (completed seasons
  only) — see SKILL.md steps 4–5 for the exact shape and the self-contained-text requirement.
- **No usable CC BY-SA source?** Don't stretch to copyrighted sites — log it:
  `node functions/scripts/recap-upload.mjs --unsourced <tmdbId> "<title>" <no-wiki|partial-coverage|incompatible-license>`
- **Spot-check** a sample of the batch before upload (cached forever — a bad one is public to all).
- Emit a `scripts/recaps/<show>.local.json` array of `{ tmdbId, season, episode, text, model, sources }`.

## 3. Upload

```
GOOGLE_APPLICATION_CREDENTIALS=/abs/path/recaps-writer.json \
  node functions/scripts/recap-upload.mjs scripts/recaps/<show>.local.json
```

The script re-validates every entry (plain-text guard mirroring `sanitize.ts`; CC BY-SA attribution
required; http(s) source URLs) and skips+logs any that fail. It writes `recaps/{id}` via Admin SDK.
Season entries (`kind: 'season'`) are refused unless every episode 1..`episodeCount` for that season
already has a boundary doc (in this batch or previously indexed), and are written ONCE — a season doc
that already exists is skipped unless you pass `--force` (season regen is non-deterministic; don't
let an accidental rerun silently overwrite one with different output).

**NOTE:** the script lives at `functions/scripts/recap-upload.mjs` (not `scripts/`) so it resolves
`firebase-admin` from `functions/node_modules` — the repo root deliberately has no firebase-admin. Run it
from the repo root (as above) so the relative data paths resolve.

**The coverage index is MANDATORY.** The client finds recaps only via `recaps/{tmdbId}_index` (maintained
automatically by every upload; `--index-only <file>` backfills without rewriting docs). Rules:
- If the script reports `INDEX WRITE FAILED`, the uploaded recaps are invisible until you re-run the
  printed `--index-only` command.
- Never run two uploads for the SAME show concurrently — the index merge is last-writer-wins.
- `--index-only` re-validates entries against the current text guard; if the guard has been tightened
  since a recap was uploaded, that entry is SKIPped (and stays out of the index) — review the recap and
  re-generate it rather than forcing it in.
- Deleting a bad recap doc (purge, §5)? Also remove its `s_e` key from the index doc, or the client wastes
  bounded fallback reads on the phantom entry.

## 4. Go live

After the FIRST batch has seeded recaps, flip the client flag: set `RECAPS_ENABLED = true` in
`src/lib/recaps/config.ts`, commit, push (hosting auto-deploys). Until then the button never shows.

## 5. Purge / regenerate a bad recap

A cached recap can only be changed via Admin SDK. To fix a poisoned/wrong one: regenerate it into a new
`*.local.json` and re-run the upload (it overwrites the same doc id), or delete it:

```
GOOGLE_APPLICATION_CREDENTIALS=/abs/path/recaps-writer.json \
  node -e "const{initializeApp,applicationDefault}=require('firebase-admin/app');const{getFirestore}=require('firebase-admin/firestore');initializeApp({credential:applicationDefault()});getFirestore().doc('recaps/TMDBID_S_E').delete().then(()=>console.log('deleted'))"
```

Detection: the per-batch spot-check (§2) is the primary net. A user-facing "rapportera sammanfattning"
affordance is a planned fast-follow (needs a `submitReport` recap target type).
