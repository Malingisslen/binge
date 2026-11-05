import { describe, it, expect, vi } from 'vitest';

// The leaving count reads Firestore in the browser; metadata never renders it.
vi.mock('@/components/pages/VartDetLeavingCount', () => ({ default: () => null }));
import { generateMetadata, generateStaticParams } from './page';

// Malin published the month page on 2026-11-04, so Google may index it.
describe('/vart-det/[month]/ metadata', () => {
  it('builds the listed months, each indexable with its own canonical', async () => {
    expect(generateStaticParams()).toEqual([{ month: '2026-11' }]);
    const meta = await generateMetadata({ params: Promise.resolve({ month: '2026-11' }) });
    expect(meta.robots).toEqual({ index: true, follow: true });
    expect(meta.alternates?.canonical).toBe('https://binge.nu/vart-det/2026-11/');
    expect(meta.title).toBe('Värt det i november 2026');
  });
});
