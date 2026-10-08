import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => {
  const router = { push: vi.fn() };
  return { useRouter: () => router };
});
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ uid: null }) }));

import StreamingkostnadPage, { metadata } from './page';

// #26:s villkor 3 och #28:s villkor 12: rubrik och introtext, med "listpris, kan
// avvika", står i den statiska HTML:en; canonical pekar på den slashade URL:en.
describe('/streamingkostnad/', () => {
  it('server-renders the heading and the list-price caveat', () => {
    const html = renderToStaticMarkup(<StreamingkostnadPage />);
    expect(html).toContain('Vad kostar din streaming?');
    expect(html).toContain('listpris, kan avvika');
  });

  it('has a canonical URL and is indexable', () => {
    expect(metadata.alternates?.canonical).toBe('https://binge.nu/streamingkostnad/');
    expect(metadata.robots).toBeUndefined();
  });
});
