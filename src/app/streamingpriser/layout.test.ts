import { describe, it, expect } from 'vitest';
import { metadata } from './layout';

// #26:s villkor 2: prissidan är noindex (men follow) tills Malin bekräftat att
// prisagenten är schemalagd. sitemap.test.ts pinnar att den står utanför sitemapen.
describe('/streamingpriser/ metadata', () => {
  it('is noindex, follow', () => {
    expect(metadata.robots).toEqual({ index: false, follow: true });
  });
});
