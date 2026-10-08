import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { RowResult, RowSpec } from '@/types';

const refined = vi.hoisted(() => ({ value: { items: [] as unknown[], pending: true } }));
vi.mock('@/hooks/useRefinedTitles', () => ({ useRefinedTitles: () => refined.value }));
vi.mock('@/hooks/useSearchProviders', () => ({ useSearchProviders: () => ({}) }));
vi.mock('./RecCard', () => ({ default: () => null }));
vi.mock('@/hooks/useInView', () => ({ useInView: () => ({ ref: () => {}, inView: false }) }));

import RecRow from './RecRow';
import { RowEmptyContext } from './rowRefinementContext';

const rowSpec = { id: { kind: 'trending' }, rowKey: 'trending', label: 'Trendar' } as unknown as RowSpec;
const result: RowResult = { rowSpec, visible: [], backingPool: [], isLoading: false };

function renderRow(report: (key: string, empty: boolean) => void) {
  return render(
    <RowEmptyContext.Provider value={report}>
      <RecRow result={result} index={0} />
    </RowEmptyContext.Provider>,
  );
}

describe('RecRow while a filter is still fetching', () => {
  it('shows the loading view and is not reported empty', () => {
    refined.value = { items: [], pending: true };
    const report = vi.fn();
    const { container } = renderRow(report);
    expect(container.querySelector('section')).not.toBeNull();
    expect(report).not.toHaveBeenCalledWith('trending', true);
  });

  it('is reported empty, and renders nothing, once the facts have landed and nothing fits', () => {
    refined.value = { items: [], pending: false };
    const report = vi.fn();
    const { container } = renderRow(report);
    expect(container.querySelector('section')).toBeNull();
    expect(report).toHaveBeenCalledWith('trending', true);
  });
});
