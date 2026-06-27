---
name: org-retro
description: Retrospektiv mätning av Binges virtuella roll-org — läser docs/org/metrics/events.jsonl + ADR:er + world-watch state + freshness-markörer och scorar Phase-2-värde & rubber-stamp-rate, trigger-kalibrering, world-watch signal/brus + källhälsa, freshness-träffsäkerhet och kostnad/review. Inkluderar en MANUELL false-negative-stickprov. Lägen: shakedown (~dagar, kvalitativt) och full (~veckor, kvantitativt). Använd när användaren säger /org-retro, /org-retro shakedown, /org-retro full, eller "kör org-retro".
---

# /org-retro — does the role-org actually work?

Scores the virtual role-org against its own logs + artifacts. **Reads only; advises.**
It tells you whether Phase 2 earns its tokens, whether the trigger is calibrated, whether
world-watch is signal or noise, and — via a manual probe — whether anything is silently
**slipping through**. $0/interactive.

Args: `shakedown` (default if soon after launch) or `full`.

Inputs: `docs/org/metrics/events.jsonl`, `docs/org/adr/*.md`,
`docs/org/world-watch/state.json`, `docs/org/world-watch/ROLE_WORLD_MODEL.md`,
`.claude/state/dossier-stale/*.marker`.

## Modes
- **shakedown** (~3–4 days in): qualitative. Few events — confirm the pipes are wired,
  eyeball the events + ADRs, and **do the false-negative spot-check**. Goal: catch
  obvious breakage/mis-calibration early, not compute rates off n=2.
- **full** (~3–4 weeks in): quantitative. Compute every rate/ratio below and trend them
  against the last `retro` event.

## 1. Load the data
```bash
echo "=== events by type ==="; \
node -e "const fs=require('fs');const e=fs.readFileSync('docs/org/metrics/events.jsonl','utf8').trim().split('\n').filter(Boolean).map(JSON.parse);const by={};e.forEach(x=>by[x.type]=(by[x.type]||0)+1);console.log(by, '| total', e.length)"
echo "=== ADRs ==="; ls docs/org/adr/*.md 2>/dev/null | grep -v README
echo "=== world-watch lastScan ==="; node -e "const s=require('./docs/org/world-watch/state.json');for(const[k,r]of Object.entries(s.roles))console.log(k, r.lastScan, Object.keys(r.snapshot).length+' snapshots')"
echo "=== open freshness flags ==="; ls .claude/state/dossier-stale/ 2>/dev/null || echo none
```

## 2. Score

### A. Phase-2 value + RUBBER-STAMP RATE
From `review` events:
```bash
node -e "const fs=require('fs');const r=fs.readFileSync('docs/org/metrics/events.jsonl','utf8').trim().split('\n').filter(Boolean).map(JSON.parse).filter(x=>x.type==='review'&&x.tier!=='skip');const rs=r.filter(x=>x.rubber_stamp).length;console.log('reviews',r.length,'| rubber-stamp',rs,r.length?('('+Math.round(100*rs/r.length)+'%)'):'',  '| avg must_haves', r.length?(r.reduce((a,x)=>a+(x.must_haves||0),0)/r.length).toFixed(1):'-')"
```
- **Rubber-stamp rate** = `rubber_stamp:true` / reviews. **High (>~40%) = the panel isn't
  earning its cost** → tighten the trigger (narrower high-stakes list) or shrink panels.
- Cross-check: do `review` events with `adrs` correspond to real ADR files? Did escalations
  reach a human decision (look in the ADR's "Escalated to human")?

### B. Trigger calibration (fired vs actually ran)
```bash
node -e "const fs=require('fs');const e=fs.readFileSync('docs/org/metrics/events.jsonl','utf8').trim().split('\n').filter(Boolean).map(JSON.parse);const t=e.filter(x=>x.type==='trigger'),r=e.filter(x=>x.type==='review');console.log('triggers',t.length,'| reviews',r.length);t.forEach(x=>{const ran=r.find(y=>Math.abs(new Date(y.ts)-new Date(x.ts))<6*3600e3);console.log(' ',x.ts,'signals=['+(x.signals||[]).join(',')+']',ran?'→ review ran':'→ no review within 6h')})"
```
- **Over-firing**: many `trigger`s, few followed by a `review` → the suggestion is noise;
  narrow the signal list in `exit-plan-suggest-review.ps1`.
- **Under-firing**: caught only by the manual spot-check — a high-stakes plan that ran
  with **no** trigger (the hook missed it). Note any you know of.

### C. World-watch signal-to-noise + source health
- From `state.json` snapshots + any `world-watch` events: of the deltas seen, how many
  became tickets/escalations vs were "seen, no impact" noise?
- **Source health**: scan `ROLE_WORLD_MODEL.md` for sources flagged `dead`/`redirected`/
  bot-blocked (TMDB changelog, ETSI, Letterboxd, Chromium Dash, the Firebase
  subprocessor stale-date caveat). Are any MVP-role sources (Security/Legal/DPO) now
  unreachable? Flag for re-verification.

### D. Freshness accuracy
- Did a flagged dossier actually contain drift? Cross-ref `.claude/state/dossier-stale/`
  history + any `freshness` events + the role doc's git log: when a marker fired and
  `/refresh-dossiers` ran, did it find a real inaccuracy (good) or clear with no change
  (a false-positive flag — acceptable, but track the rate)?

### E. Cost/review
- Average `approx_tokens` across `review` events; trend vs the last `retro`. Watch for
  creep (panels growing) and confirm the tier gate is keeping medium plans cheap
  (single-reviewer reviews should be ~1/5 the token cost of full panels).

## 3. Manual false-negative spot-check (REQUIRED — logs can't show misses)
The logs only show what the system *did*. To find what it *missed*, pick **one known
recent external change** in an MVP role's domain and verify it actually reached the system:
- e.g. a real recent **Next.js security advisory** (Security), an **EDPB/IMY** ruling
  (Legal), or a **Sentry sub-processor** change (DPO) — something you can confirm happened.
- Check: is there a Linear ticket / escalation / ADR / world-watch snapshot entry for it?
- **If not, that's a real false negative** — the most important finding a retro can
  produce, because nothing else surfaces it. File it and tune the source list or cadence.

## 4. Report + log
Write a short scorecard (the five scores + the spot-check verdict + concrete tuning
actions). Then log the retro so trends persist:
```bash
node docs/org/metrics/log_event.mjs retro '{"mode":"shakedown","summary":"...","scores":{"rubber_stamp_pct":0,"triggers":0,"reviews":0,"false_negative":false}}'
```

## Hard rules
- **Read-only / advise**: never edits app code, never auto-acts; tuning is a recommendation.
- **Don't compute rates off noise**: in `shakedown` with n≈1–3 events, report qualitatively
  ("wired, one review, not yet enough to rate") — don't present a 100%/0% as meaningful.
- **The spot-check is the point**: a clean-looking dashboard with a missed external change
  is worse than an honest "S/N unknown, but I verified X reached the system."
