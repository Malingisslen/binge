import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SortableTh } from './SortableTh';

const renderTh = (dir: 'asc' | 'desc', onSort = vi.fn()) => {
  render(
    <table><thead><tr>
      <SortableTh label="Betyg" sortKey="rating" activeKey="rating" dir={dir} onSort={onSort} />
      <SortableTh label="År" sortKey="year" activeKey="rating" dir={dir} onSort={onSort} />
    </tr></thead></table>,
  );
  return onSort;
};

describe('SortableTh', () => {
  it('reports the sort key when clicked', () => {
    const onSort = renderTh('desc');
    fireEvent.click(screen.getByRole('button', { name: /År/ }));
    expect(onSort).toHaveBeenCalledWith('year');
  });

  it('marks only the active column with its direction', () => {
    renderTh('asc');
    expect(screen.getByRole('columnheader', { name: /Betyg/ })).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getByRole('columnheader', { name: /År/ })).toHaveAttribute('aria-sort', 'none');
  });

  it('flips to descending', () => {
    renderTh('desc');
    expect(screen.getByRole('columnheader', { name: /Betyg/ })).toHaveAttribute('aria-sort', 'descending');
  });
});
