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

## Results — 2026-06-23

| Engine | Strict exact-match |
|---|---|
| `gemini-2.5-flash-lite` (tuned prompt + schema descriptions) | 30.8% |
| `gemini-2.5-flash` (all 11 fields) | 55.4% |
| `gemini-2.5-flash` (7 core fields only) | 64.6% |
| **deterministic parser** (`--engine deterministic`, no LLM) | **98.5%** ✅ |

### Why the LLMs failed

Both Gemini models, even after prompt tuning + per-property schema descriptions:
- **`voteAverageMin`** — *hallucinate* a 7.5 rating floor on queries that ask for none.
- **`excludeSeen`** — weak extraction of "jag inte sett / inte börjat" (R≈25%).
- **`decade`** — Flash-Lite never emits it (0%); Flash barely (25%).

They were good at `mediaType`/`providerIds`/`mood`/`runtimeMax`/`genreIds` (≥84% F1).

### Why the deterministic parser wins (`deterministic.mjs`)

The filter dimensions are overwhelmingly **keyword-driven** — decade ("80-talet"),
exclude-seen ("inte sett"), rating words ("hyllad"), provider names, runtime, language,
named genres. Plain rules nail exactly the fields the LLM hallucinated/missed (decade,
excludeSeen, voteAverageMin all 100%), never invent a filter, cost nothing, and run
instantly with no key or rate limit.

> ⚠️ **98.5% is optimistic.** The gold set was authored here and the rules tuned against
> it, so it overstates real-world accuracy. Real queries will hit phrasings the rules
> miss. Treat this as "the approach clears the bar," not "production is 98% accurate."
> Grow `queries.json` with REAL user queries and re-measure.

### Recommended architecture: deterministic-first, LLM-fallback

1. **Deterministic parser is the primary path** — `src/lib/askBinge/parseSearch.ts`
   (promote `deterministic.mjs`). Handles the keyword-y majority for free + instantly.
2. **LLM fallback only for the fuzzy residual** — when the parser yields nothing/low
   confidence (similes like "a slow-burn like Severance", novel slang). The LLM rarely
   fires, so cost stays near zero AND the long tail is covered. `gemini-2.5-flash`
   (not lite) is the fallback if/when added; Claude Haiku is also testable via `--model`
   + Anthropic support.
3. The few stubborn LLM fields (rating/exclude-seen/decade) can ALSO be UI controls.

Build plan: `docs/superpowers/plans/2026-06-23-bin-176-ask-binge.md`.
