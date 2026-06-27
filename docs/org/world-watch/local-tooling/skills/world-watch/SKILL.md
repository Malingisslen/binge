---
name: world-watch
description: Kör en world-watch-scan för Binges virtuella roll-org — pollar varje förfallen rolls källor, diffar mot förra snapshoten och routar äkta förändringar (auto-ticket för Security, escalate-human för Legal/DPO). Använd när användaren säger /world-watch, "kör world-watch", "kolla omvärldsbevakningen", eller när SessionStart-hooken säger att en scan är due.
---

# /world-watch — external-knowledge scan for the virtual role-org

Reads the committed world-watch state, cheap-polls each **due** role's verified
sources, diffs against the last snapshot, impact-checks any delta against the role's
owned paths, and routes by authority. **It never auto-acts** — it flags, tickets
(with approval), or escalates. Costs are kept to web fetches; this runs only when you
invoke it (the $0/interactive model — see `docs/org/world-watch/DESIGN.md`).

State: `docs/org/world-watch/state.json` (committed).
MVP roles: Security Architect (4, weekly, auto-ticket), Legal/GDPR Counsel (5,
monthly, escalate-human), Data Protection Officer (6, monthly, escalate-human).

## Flow

### 1. Read state + pick roles
```bash
cat docs/org/world-watch/state.json
```
- A role is **due** when `lastScan` is null OR `(today − lastScan) ≥ cadenceDays[cadence]`
  (weekly 7 / monthly 30 / quarterly 90).
- If the user named a role (`/world-watch security`), scan just that one regardless of due.
- If nothing is due and no role was named: say so and stop.

### 2. Cheap-poll each due role's sources
For each source, fetch **once** (several roles share sources — dedup across roles in
one run):
- `type: atom` / `rss` — fetch the feed; the newest entry id/title/date is the marker.
- `type: json` — fetch and read the relevant field (e.g. latest incident id).
- `type: html` — `WebFetch` with a prompt like *"List the most recent dated items /
  release versions / advisory titles on this page."* The marker is the newest
  item's title+date.

Prefer the feed/changelog deep-link already in `state.json`. Respect the honest notes
there (e.g. TMDB changelog is unreliable; some EU/Letterboxd pages 403 bots — if a
fetch fails, record `"unreachable"` for that source this run and move on; never invent
content).

### 3. Diff vs snapshot → deltas only
- Compare each source's current marker to `role.snapshot[sourceId]`.
- **No change → emit nothing** for that source.
- **Changed / new → it's a delta.** Capture: source title, the new item, its URL, and
  the date.
- First run (`snapshot` empty): this *establishes* the baseline. Don't treat every
  current item as a delta — record markers as the baseline and only surface items that
  are clearly already-actionable (see step 5 baseline rule).

### 4. Impact-check each delta
Does the delta actually touch Binge? Check it against the role's `ownedPaths` +
`watchItems` in `state.json`:
- A Next.js CVE matters only if it hits App Router / static export / a path Binge uses.
- An EDPB guideline matters only if it touches export/erasure/consent/transfers.
- A sub-processor change matters only for Firebase/Google/Sentry (Binge's processors).
Drop deltas with no plausible Binge impact (note them as "seen, no impact" — still
update the snapshot marker so they don't resurface).

### 5. Route by authority
- **auto-ticket** (Security): draft a Linear issue (project **Binge** — filter on
  project, never team; see the linear memory). Title `[world-watch] <concise>`,
  body = source link + the new item + concrete repo impact (which owned path /
  watch-item) + suggested action. **On a baseline run, or whenever asked, SHOW the
  candidate first and get the owner's OK before creating.** If the Linear MCP can't
  create the issue, output a ready-to-paste draft.
- **escalate-human** (Legal, DPO): **never file, never assert law.** Present to the
  owner: *here's the change, here's the source link, here's the part of Binge it might
  touch, here's the question for you.* Let Malin decide.
- **flag-only** (future roles): collect into a short digest, no ticket.

Always cite the source URL for every item. Never state a law/policy/term without a link.

### 6. Update snapshot + lastScan + commit
- Write each scanned source's current marker into `role.snapshot[sourceId]`.
- Set `role.lastScan` to today (ISO date).
- Bump top-level `updated`.
- Commit just `state.json` (+ any doc), e.g.
  `chore(world-watch): baseline snapshots for Security/Legal/DPO` — and push per the
  /commit flow. (state.json is the only file that should change from a scan.)

## Hard rules (from the constitution)
- Cite every source; never assert law/policy without a link.
- Never auto-*act* — only flag / ticket / escalate.
- Show candidate tickets before writing to the tracker on the baseline run.
- Don't scan from a hook or unattended — only from an interactive invocation.
- If a source is unreachable, say so honestly; don't fabricate a delta.

## Gotchas
- **Shared sources**: EDPB news (Legal+DPO), Firebase release notes family
  (Security+DPO+others). Fetch once per run, fan the delta to each subscribing role.
- **Markers, not full content**: store a compact marker (newest title+date or version)
  in `snapshot`, not the page body — keeps `state.json` small and diffable.
- **Conservative on ambiguity**: if you can't tell whether a delta impacts Binge,
  escalate-human rather than auto-ticket.
