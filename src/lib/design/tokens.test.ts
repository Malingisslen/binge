import { describe, it, expect } from 'vitest';
import config from '../../../tailwind.config';

type ColorFn = (args: { opacityValue?: string | number }) => string;
const colors = (config.theme?.extend?.colors ?? {}) as unknown as Record<string, ColorFn>;
// Without a modifier Tailwind calls the colour with no opacity, or with its own
// --tw-*-opacity variable; both must give the plain CSS var.
const plain = (name: string) => colors[name]({});

describe('design tokens', () => {
  it('exposes a danger color token mapped to the CSS var', () => {
    expect(plain('danger')).toBe('var(--danger)');
    expect(plain('danger-soft')).toBe('var(--danger-soft)');
    expect(plain('danger-ink')).toBe('var(--danger-ink)');
    expect(colors.danger({ opacityValue: 'var(--tw-bg-opacity)' })).toBe('var(--danger)');
  });

  // A bare var() cannot be split into channels, so before this an opacity
  // modifier (bg-acc-deep/10) generated no CSS and the tint never showed.
  it('an opacity modifier mixes the token with transparent', () => {
    expect(colors['acc-deep']({ opacityValue: '0.1' })).toBe(
      'color-mix(in oklch, var(--acc-deep) calc(0.1 * 100%), transparent)',
    );
    expect(colors['acc-deep']({ opacityValue: 0 })).toBe(
      'color-mix(in oklch, var(--acc-deep) calc(0 * 100%), transparent)',
    );
  });
});
