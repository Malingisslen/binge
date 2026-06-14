import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useInView } from './useInView';

describe('useInView', () => {
  it('faller tillbaka på inView=true när IntersectionObserver saknas och en nod fästs (jsdom/SSR)', () => {
    const orig = (globalThis as any).IntersectionObserver;
    // jsdom saknar IntersectionObserver — säkerställ att den är borta.
    delete (globalThis as any).IntersectionObserver;
    const { result } = renderHook(() => useInView<HTMLDivElement>());
    // callback-ref:en triggar effekten när noden fästs; utan IO → inView=true.
    act(() => { result.current.ref(document.createElement('div')); });
    expect(result.current.inView).toBe(true);
    if (orig) (globalThis as any).IntersectionObserver = orig;
  });
});
