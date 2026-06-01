import { describe, it, expect } from 'vitest';
import config from '../../../tailwind.config';

describe('design tokens', () => {
  it('exposes a danger color token mapped to the CSS var', () => {
    const colors = (config.theme?.extend?.colors ?? {}) as Record<string, string>;
    expect(colors.danger).toBe('var(--danger)');
    expect(colors['danger-soft']).toBe('var(--danger-soft)');
    expect(colors['danger-ink']).toBe('var(--danger-ink)');
  });
});
