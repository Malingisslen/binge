/**
 * Retry a build-time async fetch a few times with linear backoff.
 *
 * Build-time TMDB fetches flake intermittently ("fetch failed") under the
 * 25k-page static export's concurrency. A single miss would empty a whole SEO
 * landing page (notFound / empty state), so the pre-rendered pages retry. Retry
 * PER CALL (not per page): a flaked TV discover must not re-run an already
 * successful movie discover on the same page.
 *
 * `backoffStepMs` scales the linear wait (step, 2×step, 3×step …). The genre
 * pages pass a longer step — they make one call each, so a longer tail costs
 * seconds, not build minutes; /billigaste keeps the shorter default.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts: number,
  backoffStepMs = 300,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, backoffStepMs * (i + 1)));
    }
  }
  throw lastErr;
}
