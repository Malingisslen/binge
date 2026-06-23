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
GEMINI_API_KEY=... node scripts/askbinge-eval/run.mjs --model gemini-2.5-flash-lite
GEMINI_API_KEY=... node scripts/askbinge-eval/run.mjs --limit 10        # quick smoke test
GEMINI_API_KEY=... node scripts/askbinge-eval/run.mjs --json > run1.json # dump for diffing
```

No npm install — it's plain `node` (≥18). All progress/report prints to **stderr**;
only `--json` writes machine output to stdout.

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

When the gate passes, the production build follows
`docs/superpowers/plans/2026-06-23-bin-176-ask-binge.md`.
