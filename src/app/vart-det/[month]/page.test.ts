import { describe, it, expect, vi } from 'vitest';

// The leaving count reads Firestore in the browser; metadata never renders it.
vi.mock('@/components/pages/VartDetLeavingCount', () => ({ default: () => null }));
import { generateMetadata, generateStaticParams } from './page';

// The month page stays out of Google until Malin has seen it (#26's condition 1).
describe('/vart-det/[month]/ metadata', () => {
  it('builds the listed months, each noindex but follow with its own canonical', async () => {
    expect(generateStaticParams()).toEqual([{ month: '2026-11' }]);
    const meta = await generateMetadata({ params: Promise.resolve({ month: '2026-11' }) });
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.alternates?.canonical).toBe('https://binge.nu/vart-det/2026-11/');
    expect(meta.title).toBe('Värt det i november 2026');
  });
});
