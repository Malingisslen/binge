import { describe, it, expect } from 'vitest';
import { redactVendorBody, MOTN_HOST } from './motnVendor';

/**
 * BIN-857. The expression this module replaces lived verbatim in both MOTN
 * clients and was pinned by nothing at all — including the one property that
 * makes it correct rather than merely present.
 */
describe('redactVendorBody', () => {
  const KEY = 'abcdef0123456789-live-rapidapi-key';

  // THE decisive case — and NOT the one BIN-857 named. A key at offset 0 of a
  // long body sits entirely inside the kept 300 chars, so truncate-then-mask
  // removes it just as completely as mask-then-truncate: both orders pass, and
  // a test built on it is green for the wrong reason. Verified by mutation
  // 2026-08-14 — the swapped implementation survived that test 6/6.
  //
  // The two orders only diverge when the key STRADDLES the cap. Truncating
  // first cuts the credential in half and leaves the leading half sitting
  // unmasked in the log line, because `replaceAll` then looks for a whole key
  // that is no longer there. Masking first removes it before the cut.
  it('leaves no fragment of a key that straddles the truncation boundary', () => {
    const lead = 'e'.repeat(290);            // key starts at 290, cap is 300
    const body = `${lead}${KEY}${'z'.repeat(400)}`;

    const out = redactVendorBody(body, KEY);

    expect(out).not.toContain(KEY);
    // The half a truncate-first implementation would strand: the key's own
    // first ten characters, still readable at the end of the logged slice.
    expect(out).not.toContain(KEY.slice(0, 10));
  });

  // The case the ticket asked for. Weaker than the one above on its own, but
  // it pins the plain-language promise ("a key at the start never survives")
  // and fails if redaction is dropped altogether.
  it('removes a key sitting at the very start of a body longer than the cap', () => {
    const body = `${KEY}: unauthorized. ${'x'.repeat(500)}`;

    const out = redactVendorBody(body, KEY);

    expect(out).not.toContain(KEY);
    expect(out.startsWith('[redacted]')).toBe(true);
  });

  it('removes a key sitting in the middle of the kept slice', () => {
    const body = `${'x'.repeat(100)} rejected key ${KEY} ${'y'.repeat(500)}`;

    expect(redactVendorBody(body, KEY)).not.toContain(KEY);
  });

  it('truncates so a 5xx HTML page cannot flood the log', () => {
    expect(redactVendorBody('z'.repeat(5000), KEY)).toHaveLength(300);
  });

  it('leaves a short clean body exactly as the vendor sent it', () => {
    const body = '{"message":"parameter \\"output_language\\" has an invalid value: sv"}';

    expect(redactVendorBody(body, KEY)).toBe(body);
  });

  // An empty needle would make replaceAll insert the placeholder between every
  // character, turning a readable vendor message into unreadable noise at the
  // exact moment someone is trying to read it.
  it('does not mangle the body when there is no key to mask', () => {
    expect(redactVendorBody('plain vendor text', '')).toBe('plain vendor text');
  });
});

describe('MOTN_HOST', () => {
  // Both clients build their URL from this one constant now. If it ever
  // diverges again, one half of the account silently talks to nothing.
  it('is the RapidAPI streaming-availability host', () => {
    expect(MOTN_HOST).toBe('streaming-availability.p.rapidapi.com');
  });
});
