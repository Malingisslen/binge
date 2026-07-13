# ADR 0014 — SEO/AI-search: accept Lighthouse 93–96, and what NOT to build for AI

**Date:** 2026-05-22 · **Status:** Accepted (SEO sprint), live · **Via:** AI-SEO optimization sprint

## Context
An AI-SEO sprint hardened Binge for Google Search and generative-AI search (AI Overviews,
ChatGPT, Perplexity, Claude). The big win — the homepage now serves real HTML to crawlers
instead of a `Laddar…` spinner, and FAQ JSON-LD is in prerendered HTML — shipped and is
visible in the code. Two judgment calls remain worth recording because they'll otherwise
be re-litigated.

## Decision 1 — Accept Lighthouse 93–96, do not chase 100
The only things blocking 100/100/100/100 are **deliberate design choices** from CLAUDE.md,
not bugs:
- **color-contrast** — `--ink-3` muted text and small accent text are intentional dense-UI tokens.
- **font-size** — table headers (9–10px) and provider pills (9px) are the density philosophy;
  Lighthouse-100 demands ≥12px everywhere, which breaks the "tool not marketing page" feel.
- **target-size** — sub-24px tap targets on some dense controls.

The real SEO value was homepage prerender + FAQ JSON-LD in HTML, not the last 4–7 Lighthouse
points, which cost "design-system blood." **Accept 93–96.** If we ever want 100, a separate
design sprint can introduce a darker `--ink-3-strong` token and bump the exact 9–10px classes
to 12px *only where they appear in prerendered HTML* — keeping the dense feel on internal pages.

## Decision 2 — Do NOT build these "for AI" (Google says they don't help)
- ❌ More schema.org "for AI" (generative AI works with multi-topic content).
- ❌ Chunking content into "AI-readable" pieces.
- ❌ Rewriting copy in an "AI-friendly" style (AI understands synonyms/intent).
- ❌ Per-query landing pages ("how do I stream X in Sweden") — scaled-content spam.
- ❌ Fake mentions from other sites — spam systems catch it.
- ❌ Long-tail-keyword page multiplication.

`Movie`/`TVSeries` schema may be worth it for *classic* rich-results if we ever want it — but
not for AI. Keep Organization + per-page OpenGraph; add nothing more "for AI."

## Consequences
- The Lighthouse scores are a settled trade-off; a future contributor "fixing" contrast/font
  tokens to hit 100 would break the design system — check this ADR first.
- The NOT-list is standing guidance for any future SEO work.

## Decided by
Recommendation accepted 2026-05-22; recorded on the 2026-07-13 docs-sweep when the
AI-SEO sprint plan (work shipped) was retired.
