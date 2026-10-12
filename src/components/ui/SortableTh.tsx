import { thClass } from './tableHead';

interface Props<K extends string> {
  label: string;
  sortKey: K;
  activeKey: K;
  dir: 'asc' | 'desc';
  onSort: (key: K) => void;
  className?: string;
}

// A column heading that sorts its table: the whole label is one button, and the arrow
// shows direction only on the active column.
export function SortableTh<K extends string>({ label, sortKey, activeKey, dir, onSort, className }: Props<K>) {
  const active = sortKey === activeKey;
  return (
    <th
      className={thClass(className)}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 uppercase cursor-pointer hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {label}
        <span aria-hidden="true" className={active ? 'text-ink' : 'opacity-0'}>
          {active && dir === 'asc' ? '↑' : '↓'}
        </span>
      </button>
    </th>
  );
}
