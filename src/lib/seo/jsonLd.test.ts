import { describe, it, expect } from 'vitest';
import { jsonLd } from './jsonLd';

describe('jsonLd', () => {
  it('produces JSON that parses back to the original object', () => {
    const data = { '@type': 'Movie', name: 'Dune', year: 2021 };
    // The escape sequence is valid JSON, so a parser reconstructs the value.
    expect(JSON.parse(jsonLd(data))).toEqual(data);
  });

  it('escapes every "<" so a "</script>" in a value cannot break out of the block', () => {
    const out = jsonLd({ name: 'Trouble </script><script>alert(1)</script>' });
    // No raw "<" survives — the whole point of the guard.
    expect(out).not.toContain('<');
    expect(out).toContain('\\u003c');
    // …but it is still valid JSON that round-trips to the original string.
    expect(JSON.parse(out).name).toBe('Trouble </script><script>alert(1)</script>');
  });

  it('leaves ">" and other characters untouched', () => {
    expect(jsonLd({ a: 'x > y' })).toContain('x > y');
  });
});
