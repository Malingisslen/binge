// BIN-185 — recap text guard. Wikipedia/fan wikis are world-editable, so a recap's
// source text is UNTRUSTED: a crafted edit could smuggle markup, links, or prompt-
// injection into text that is then cached forever and served to every viewer. This is
// the shared validator both the /recap batch (before upload) and any consumer use — one
// path, so the two can't drift (Security). Output is asserted plain text; the client
// renders it as plain text (never dangerouslySetInnerHTML / a markdown renderer).

/** Hard length cap — a per-episode Swedish recap is a few short paragraphs, not an essay. */
export const MAX_RECAP_CHARS = 4000;

export interface RecapValidation {
  ok: boolean;
  reason?: string;
}

// Any HTML/tag-like construct: `<` IMMEDIATELY followed by `/` or a letter … `>`
// (a real tag start). A bare `<`/`>` used as a comparison char has a space after it,
// so normal prose ("a < b och c > d") does not match.
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/;
// Markdown link `[text](url)` or image `![alt](url)`.
const MARKDOWN_LINK = /!?\[[^\]]*\]\([^)]*\)/;
// Embedded URLs — recap prose carries no links (sources live in the credit component).
// Catches http(s)://, www., AND scheme-less domain+path (e.g. "spam.example/rea") — the
// last so a poisoned wiki edit can't smuggle a bare link past the guard. Requires a real
// letter TLD + a slash-path, so numeric ratios like "3.5/5" and abbreviations don't trip.
const URL_LIKE = /(https?:\/\/|\bwww\.|\b[a-z0-9-]+\.[a-z]{2,}\/\S)/i;
// Code fences — a common injection wrapper.
const CODE_FENCE = /```/;
// Prompt-injection phrases (EN + SV), matched anywhere — strong signals.
const INJECTION_PHRASE = /(ignore\s+(all\s+)?previous|disregard\s+(all\s+)?previous|strunta\s+i\s+(tidigare|föregående)|you\s+are\s+now|reveal\s+the\s+(system\s+)?prompt)/i;
// Chat role markers — ONLY at a line start (that's the injection shape). Anchoring here
// means an ordinary word ending "…system:" / "…assistant:" mid-sentence is NOT rejected.
const ROLE_MARKER = /(^|\n)\s*(system|assistant|user|användare)\s*:/i;

/**
 * Validate a candidate recap string as safe plain text. Returns { ok, reason }.
 * Rejects: empty/whitespace-only; over the length cap; any HTML tag; markdown
 * links/images; embedded URLs; code fences; prompt-injection meta-strings.
 */
export function validateRecapText(text: string): RecapValidation {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { ok: false, reason: 'empty' };
  }
  if (text.length > MAX_RECAP_CHARS) {
    return { ok: false, reason: `too long (>${MAX_RECAP_CHARS} chars)` };
  }
  if (HTML_TAG.test(text)) return { ok: false, reason: 'contains HTML/tag-like markup' };
  if (MARKDOWN_LINK.test(text)) return { ok: false, reason: 'contains a markdown link/image' };
  if (URL_LIKE.test(text)) return { ok: false, reason: 'contains a URL' };
  if (CODE_FENCE.test(text)) return { ok: false, reason: 'contains a code fence' };
  if (INJECTION_PHRASE.test(text) || ROLE_MARKER.test(text)) {
    return { ok: false, reason: 'contains prompt-injection meta-strings' };
  }
  return { ok: true };
}
