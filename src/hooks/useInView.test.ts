import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useInView } from './useInView';

describe('useInView', () => {
  it('faller tillbaka på inView=true när IntersectionObserver saknas och en nod fästs (jsdom/SSR)', () => {
    const g = globalThis as { IntersectionObserver?: unknown };
    const orig = g.IntersectionObserver;
    // jsdom saknar IntersectionObserver — säkerställ att den är borta.
    delete g.IntersectionObserver;
    const { result } = renderHook(() => useInView<HTMLDivElement>());
    // callback-ref:en triggar effekten när noden fästs; utan IO → inView=true.
    act(() => { result.current.ref(document.createElement('div')); });
    expect(result.current.inView).toBe(true);
    if (orig) g.IntersectionObserver = orig;
  });
});
