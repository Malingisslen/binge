# Ask Binge — accuracy eval (BIN-176 gate)

The **gate before any feature code**: does Gemini Flash-Lite reliably translate a
Swedish sentence into Binge's structured filter? This harness measures exactly that
against 65 gold-labeled queries. The LLM never sees the catalog — it only emits a
filter — so translation accuracy is the *whole* risk.

## Run it

You need a Gemini API key (free tier is plenty for 65 calls):
👉 https://aistudio.google.com/apikey

```bash
# from repo root
GEMINI_API_KEY=your_key node scripts/askbinge-eval/run.mjs

# options
GEMINI_API_KEY=... node scripts/askbinge-eval/run.mjs --model gemini-2.5-flash
GEMINI_API_KEY=... node scripts/askbinge-eval/run.mjs --limit 10            # quick smoke test
GEMINI_API_KEY=... node scripts/askbinge-eval/run.mjs --concurrency 1       # free-tier safe (no 429s)
GEMINI_API_KEY=... node scripts/askbinge-eval/run.mjs --fields mediaType,genreIds,mood,runtimeMax,providerIds,myProvidersOnly,originalLanguage  # score only a subset
GEMINI_API_KEY=... node scripts/askbinge-eval/run.mjs --json > run1.json    # dump for diffing
```

No npm install — it's plain `node` (≥18). All progress/report prints to **stderr**;
only `--json` writes machine output to stdout.

> **Free-tier keys:** the default `--concurrency 2` keeps you under the RPM cap. The
> first run here bursted at 4 and ~38% of calls hit 429s (which tank the score). If you
> see "API errors" in the summary, drop to `--concurrency 1`.

## Reading the result

- **Strict exact-match** — the headline. Every field the model emits matches the
  gold label exactly (arrays compared as sets), and it didn't invent fields the
  sentence didn't ask for. This is the honest number.
- **Tolerant exact-match** — same, but counts a `mood` answered as the equivalent
  `genreIds` (and vice versa) as correct, and `voteAverageMin` within ±0.5. Upper bound.
- **Per-field P/R/F1** — shows *where* it fails. Low recall on `providerIds` means
  it misses services; high `fp` on `excludeSeen` means it over-triggers. This tells
  you whether to fix the prompt or the schema.

**Pass bar: 85% strict.** Above it → Flash-Lite is good enough; build the feature.
Below it → tune the system prompt in `schema.mjs` (or try `gemini-2.5-flash`) and
re-run before writing any production code. Exit code is 0 on pass, 1 on fail (CI-friendly).

## Cost sanity (why Flash-Lite)

Each call is ~700 input + ~80 output tokens. At Gemini 2.5 Flash-Lite list pricing
(~$0.10 / 1M input, ~$0.40 / 1M output) that's well under **0.001 SEK per query** —
i.e. thousands of "Ask Binge" searches per month for a few öre, comfortably inside
the 25 SEK/mån cap. The production function adds a 24h query cache + a global daily
ceiling + per-user rate-limit (same shape as the OMDb backfill), so the real cost is
far lower than even that. The accuracy gate, not cost, is the open question — hence
this harness.

## Files

- `schema.mjs` — the filter schema + system prompt + enum values (mirrors the real
  app dimensions: `moodLens`, `runtimeLens`, `genreLabels`, `providers`).
- `queries.json` — 65 gold-labeled cases. Add your own real searches here to grow it.
- `run.mjs` — the runner + grader.

## Results — first run, 2026-06-23

The gate **did not pass.** Best configuration reached 65% strict vs the 85% bar.

| Config | Strict exact-match |
|---|---|
| `gemini-2.5-flash-lite` (tuned prompt + schema descriptions) | **30.8%** |
| `gemini-2.5-flash` (all 11 fields) | **55.4%** |
| `gemini-2.5-flash` (7 core fields only) | **64.6%** |

What both models get **right** (≥84% F1 on Flash): `mediaType`, `providerIds`, `mood`,
`runtimeMax`, `genreIds` precision — i.e. the dimensions that most shape the result set.

What they get **wrong**, even after prompt tuning + schema field descriptions:
- **`voteAverageMin`** — both models *hallucinate* a 7.5 rating floor on queries that ask
  for no quality bar. Ignored every "sätt ALDRIG 7.5" instruction. The single biggest
  strict-match killer.
- **`excludeSeen`** — weak extraction of "jag inte sett / inte börjat" (R≈25%).
- **`decade`** — Flash-Lite never emits it (0%); Flash barely (25%) even with examples.

**Takeaways for the build decision:**
1. **Flash-Lite is out** (31%) — the cost argument is moot if it isn't accurate enough.
2. **Flash** is 2× better but pricier and *still* below bar at 55–65%.
3. The fields the LLM fails (`voteAverageMin`, `excludeSeen`, `decade`) are exactly the
   ones that work fine as **UI controls** (a rating slider, an "exclude seen" toggle
   default-on, a decade picker). Narrowing the LLM to the 7 core dimensions lifts Flash to
   65% — closer, but genre recall + language over-trigger still need work to clear 85%.
4. The harness is **model-agnostic** (`--model`). The obvious next experiment is the
   originally-proposed **Claude Haiku** — it would directly re-test the Claude-vs-Gemini
   call with data (needs Anthropic-API support added to `run.mjs` + an `ANTHROPIC_API_KEY`).

When the gate eventually passes, the production build follows
`docs/superpowers/plans/2026-06-23-bin-176-ask-binge.md`.
