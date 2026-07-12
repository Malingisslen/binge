# BIN-185 recaps — operator runbook (P3)

Spoiler-safe catch-up recaps. The `recaps/{tmdbId}_{s}_{e}` cache is public-read / admin-write; the
ONLY writer is the local `/recap` batch below. Spec:
`docs/superpowers/specs/2026-07-12-bin185-spoiler-safe-recaps-design.md`. ADR: `docs/org/adr/0011-*`.

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
- Resolve the show + its season/episode list; prioritise by the stored insikter `topTitles` (TV).
- For **each** boundary `(s,e)`: read **per-episode** summaries for episodes **≤ (s,e)** from Wikipedia and
  other **CC BY-SA-compatible** wikis (verify each source's licence footer; SKIP all-rights-reserved). Stay
  strictly on episode-specific pages ≤ the boundary — never character/overall-plot pages (they span the
  whole series → spoilers).
- Write an original Swedish `sammanfattning` — **paraphrase, never copy verbatim phrasing or track a
  source's structure** (Legal). Record every source in `sources[]`.
- **No usable CC BY-SA source?** Don't stretch to copyrighted sites — log it:
  `node scripts/recaps/upload.mjs --unsourced <tmdbId> "<title>" <no-wiki|partial-coverage|incompatible-license>`
- **Spot-check** a sample of the batch before upload (cached forever — a bad one is public to all).
- Emit a `scripts/recaps/<show>.local.json` array of `{ tmdbId, season, episode, text, model, sources }`.

## 3. Upload

```
GOOGLE_APPLICATION_CREDENTIALS=/abs/path/recaps-writer.json \
  node scripts/recaps/upload.mjs scripts/recaps/<show>.local.json
```

The script re-validates every entry (plain-text guard mirroring `sanitize.ts`; CC BY-SA attribution
required; http(s) source URLs) and skips+logs any that fail. It writes `recaps/{id}` via Admin SDK.

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
