# Meta-Prompt: Generate a Forensic Analysis Prompt System for a New Project

**Purpose:** Adapt the Butlery/Binge analysis prompt architecture to any
new project, producing a complete 12-file analysis system tailored to
that project's stack, domain, and unique differentiators.

**When to use:** You have a new project (codebase) and want the same
kind of rigorous, two-phase, weighted-dimension analysis that was
produced for Butlery (Flutter recipe app) and Binge (Next.js media
tracker).

**Input you must be given:**
1. **Reference prompts** — path to an existing adapted prompt system.
   Recommended: `C:/Butlery/butlery/docs/analysis/prompts/` (the original
   Butlery v4.1 system, 12 files) and/or
   `C:/binge/docs/analysis/prompts/` (the Binge adaptation).
2. **Target project** — absolute path to the project root.
3. **Output directory** — where the generated prompts should live
   (usually `<target>/docs/analysis/prompts/`).

**Output:** 12 markdown files:
- `MASTER_ANALYSIS_ORCHESTRATOR.md`
- `01_CODE_QUALITY_AND_ARCHITECTURE.md`
- `02_SECURITY_AND_COMPLIANCE.md`
- `03_INFRASTRUCTURE_AND_OPERATIONS.md`
- `04_PERFORMANCE_AND_SCALABILITY.md`
- `05_DEPENDENCIES_AND_SUPPLY_CHAIN.md`
- `06_UX_DESIGN_AND_I18N.md`
- `07_<PROJECT_UNIQUE>.md` (see below)
- `08_PRODUCT_ANALYTICS_AND_GROWTH.md`
- `09_TRUST_SAFETY_AND_PRIVACY.md`
- `10_MONETIZATION_AND_COMPETITIVE_POSITIONING.md`
- `11_LEGAL_REVIEW.md`

---

## Methodology

### Phase A: Read the Reference in Full

**Do not skim.** Read every reference prompt end-to-end before drafting.
Each reference prompt is 600–1500 lines and contains patterns worth
preserving exactly:

- Two-phase structure (Phase 1 investigation, Phase 2 remediation)
- Weighted dimensions summing to 100
- Cross-prompt dedup rules ("topic X is owned by prompt Y, skip in Z")
- File:line reference discipline in every finding
- Executive summary format
- Per-dimension output format (CRITICAL/HIGH/MEDIUM/LOW classification)
- Phase 1 deliverables checklist at the end
- Investigation execution plan with time estimates

**Do not infer the methodology from partial reads.** If you haven't read
all 12 reference files, stop and read them first.

### Phase B: Assess Transferability

For each of the 11 reference prompts, classify for your target:

| Classification | Action |
|----------------|--------|
| **Direct** | Content translates with minor idiom swaps (language, framework names) |
| **Heavy adaptation** | Core dimensions apply but significant content must change (e.g., iOS HIG → responsive web) |
| **Omit / replace** | The reference topic is not applicable (e.g., Butlery's AI/LLM Quality prompt is replaced by TMDB Integration for Binge — different feature, same weight slot) |

Produce a transferability table up front and sanity-check it with the
user before writing 10,000 lines of prompt.

### Phase C: Gather KNOWN-Facts from the Target Project

Before writing any prompt, explore the target codebase to collect
concrete facts that anchor every prompt's "Shared Project Context"
block. Check AT MINIMUM:

**Structural**:
- `package.json` / `pubspec.yaml` — framework, runtime, dependencies
- `tsconfig.json` — strict mode, target, path aliases
- `.eslintrc*` / `analysis_options.yaml` — lint rules
- File count and line count (`find … | xargs wc -l | sort -rn | head`)
- Top 10 largest hand-written files
- Directory structure (`ls` 2 levels deep)

**Routing / architecture**:
- App Router pages / main routes
- Client vs server component split
- Custom hooks count and inventory
- Context / state management inventory

**Infrastructure**:
- `firebase.json`, `.firebaserc`, CI/CD workflows
- Hosting / deploy model
- Environment variable inventory (`.env*` files)

**Data layer**:
- `firestore.rules` — line count, collection coverage
- `firestore.indexes.json` — composite indexes
- `storage.rules` — presence / absence
- Schema: subcollections, key paths

**Security**:
- Env vars exposed client-side (`NEXT_PUBLIC_*` etc.)
- External APIs used
- Auth flow status

**Project-unique features**:
- What is the app's killer feature / differentiator?
  (Butlery: AI recipe parsing + Swedish NLP
   Binge: Swedish streaming advisor)
- Identify the slot-07 prompt name based on this.

**Documentation / guidelines**:
- Read `CLAUDE.md` in full — extract rules verbatim
- Read any DESIGN.md, ARCHITECTURE.md, or similar

**Current git status**:
- Modified / untracked files (context for pending work)
- Recent commits (context for current focus)

Capture these as citable facts — ALWAYS with file:line references or
exact command output. Do NOT write "estimated" or "around" unless you
actually verified.

### Phase D: Write the Master Orchestrator

Start with `MASTER_ANALYSIS_ORCHESTRATOR.md`. Use these sections
(preserve structure from reference):

1. **Purpose** — one paragraph on the two-phase goal
2. **Known Project Context** — a code block with EVERYTHING future
   prompts can reuse. This is the biggest section. Include:
   - Project name, positioning, target market
   - Tech stack with versions
   - Architecture summary
   - Routing pattern
   - Codebase metrics (file count, line count, top files)
   - Directory layout
   - Firestore rules / indexes / schema summary
   - Environment variables
   - External services
   - Known gaps / current state
   - Generated-file exclusions
   - CLAUDE.md-style rules verbatim (if present)
3. **Pre-Analysis Tooling** — exact commands (lint, typecheck, build,
   audit, bundle analysis) appropriate for the stack
4. **The 11 Prompts** — table with # / filename / scope / weight.
   Weights sum to 100%. Higher weight for what's critical to launch.
5. **Execution Strategy** — sequential and parallel (3 waves)
6. **Soft Dependencies** — table of "X before Y because..."
7. **Cross-Prompt Deduplication Rules** — table of topic × owner × skip-in
   (THIS IS CRITICAL. Without it, 2000 redundant lines get written.)
8. **Final Synthesis** — weighted scoring formula, interpretation bands
9. **Prompt Lineage** — note the derivation from Butlery/Binge + what
   was changed for this project
10. **Usage Example** — how to actually run the prompts

**Weight calibration heuristics**:
- A launch-critical differentiator (core feature that defines the
  product) should get 13–18%
- Table-stakes (security, code quality) get 10–13%
- Pre-launch concerns (analytics, monetization readiness) get 5–7%
- Dependencies / infrastructure / supply chain get 5–7% unless the
  project is enterprise-scale

**Cross-prompt dedup rules are non-optional**. Without them, prompts
bleed into each other and findings get double-counted. Write the dedup
table as a single source of truth.

### Phase E: Write Each Prompt

For each of 01–11, preserve the reference structure:

1. **Header** — analyst, framework (for prompts like Security that
   have a specific framework), scope, consolidates list
2. **Mission** — 2–3 paragraphs, project-specific. Reference the
   project's unique differentiator.
3. **Cross-Prompt Boundaries** — explicit list of what this prompt
   DOES and DOES NOT own. Use "Deferred to prompt NN" phrasing.
4. **Two-Phase Approach** — preserve verbatim style from reference
5. **Shared Project Context** — can be abbreviated ref back to master
   + prompt-specific details (e.g., for Security: Firestore rules
   detail; for Performance: caching strategy detail)
6. **Investigation Framework: N Dimensions (100 points total)** —
   weights sum to 100
7. **Per-dimension structure**:
   - Investigation Scope (1 sentence)
   - Specific Investigation Tasks (numbered, with code blocks for
     search patterns and file references)
   - Files to audit (bullet list)
   - Output Required (bullet list of deliverables)
8. **Scoring Framework** — per-dimension rubric
9. **Output Format** — executive summary template + per-dimension
   format + specialized tables / matrices
10. **Investigation Execution Plan** — staged with time estimates
11. **Phase 1 Deliverables Checklist**
12. **Critical Reminders** — numbered list ending with "REALISTIC" +
    project scale calibration note

**Length target**: 600–1100 lines per prompt. Shorter means you cut
corners; longer means you rambled.

### Phase F: Quality Criteria

Before declaring done:

- [ ] All 12 files created
- [ ] Weights sum to exactly 100%
- [ ] Cross-prompt dedup table has no missing owners
- [ ] Every "KNOWN" or factual claim in the master context has been
      verified against the actual codebase (not guessed)
- [ ] Each prompt's "Cross-Prompt Boundaries" section matches what
      the dedup table says
- [ ] Investigation tasks include actual file paths / line references
      / command examples from the target project, not just generic
      placeholders
- [ ] The slot-07 "project-unique" prompt genuinely covers what makes
      this project different (not a rehash of another prompt)
- [ ] Scoring rubrics are specific enough to score, not hand-wavy
- [ ] Every prompt ends with "ZERO CODE CHANGES" reminder and a
      realistic-severity calibration note

### Phase G: Register the Prompts

If writing the prompts to `<target>/docs/analysis/prompts/`:
- Ensure the directory exists
- Verify the target repo has not been touched (no code changes)
- `git status` should show 12 new untracked files, nothing else

---

## Anti-Patterns to Avoid

**Do not generate prompts from training data alone.** Always read the
reference files in the current task. The specific structure, weights,
and dedup rules evolve.

**Do not duplicate entire sections between prompts.** If two prompts
both talk about the same topic, one must defer to the other via a
"Deferred to prompt NN" note.

**Do not use generic placeholders** like `[company name]` or
`<insert project here>`. Every reference must be concrete and
verifiable against the target codebase.

**Do not over-weight rare concerns.** For a web SPA, iOS privacy
manifests are irrelevant. For a pre-launch indie app, enterprise
compliance frameworks don't apply. Calibrate.

**Do not skip the transferability table.** It's the foundation for
correct weight allocation and dedup rules.

**Do not write 11 prompts before confirming the weight table and
slot-07 choice with the user.** It's cheaper to course-correct up front.

**Do not promise tooling that doesn't exist.** If the project has no
test framework, don't write a prompt assuming one exists. Flag the
absence as a finding in prompt 03 instead.

**Do not invent project context.** If you can't verify whether
Firestore PITR is enabled, write "UNVERIFIED" — don't guess.

---

## Structure Reference (Butlery / Binge)

Both reference systems share this outline. Preserve it:

```
Reference: docs/analysis/prompts/
├── MASTER_ANALYSIS_ORCHESTRATOR.md        (~400 lines — the orchestrator)
├── 01_CODE_QUALITY_AND_ARCHITECTURE.md    (~700–1000 lines)
├── 02_SECURITY_AND_COMPLIANCE.md          (~800–1000)
├── 03_INFRASTRUCTURE_AND_OPERATIONS.md    (~700–900)
├── 04_PERFORMANCE_AND_SCALABILITY.md      (~700–900)
├── 05_DEPENDENCIES_AND_SUPPLY_CHAIN.md    (~500–700)
├── 06_UX_DESIGN_AND_I18N.md               (~700–900)
├── 07_<PROJECT_UNIQUE>.md                 (~1000–1200) ← Project differentiator
├── 08_PRODUCT_ANALYTICS_AND_GROWTH.md     (~700–900)
├── 09_TRUST_SAFETY_AND_PRIVACY.md         (~700–1000)
├── 10_MONETIZATION_AND_COMPETITIVE.md     (~700–1000)
└── 11_LEGAL_REVIEW.md                     (~1000–1200)

Total: ~10,000 lines across 12 files.
```

Reference-system variants:
- Butlery (v4.1): 10 prompts + master. `07` slot is AI/LLM Quality
  (Mistral + Swedish NLP pipeline).
- Binge: 11 prompts + master. `07` slot is TMDB Integration &
  Recommendation Logic.
- New project: `07` slot should capture your differentiating feature.

---

## Invocation

To use this meta-prompt, give Claude the following input:

```
<instructions>
Follow the META_GENERATOR.md methodology to produce a full 12-file
analysis prompt system for <PROJECT_NAME> at <PROJECT_PATH>.

Reference system: <REFERENCE_PATH>
Output directory: <OUTPUT_PATH>

Before writing the 12 files:
1. Confirm you have read the reference system in full
2. Explore the target codebase to gather concrete facts
3. Propose a transferability table (direct / heavy adapt / replace)
   and the slot-07 prompt topic
4. Propose the weight allocation summing to 100%

After the user confirms (or under auto-mode, proceed), generate all
12 files in the output directory. Do not modify any source code in
the target project.
</instructions>
```

That's the whole meta-prompt. Follow it.
