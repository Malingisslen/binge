'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { searchMunicipalities } from '@/lib/libraries/municipalities';
import { fieldClass } from '@/components/ui/Field';
import { cardClass } from '@/components/ui/Card';

/**
 * Sökbar kommunväljare (ARIA combobox med listbox). En `<select>` med 290
 * kommuner gick bara att bläddra i; här skriver man några bokstäver.
 *
 * Fältet visar alltid det sparade värdet när det inte används. Escape och
 * fokus som lämnar fältet utan val återställer det, så ett halvskrivet ord
 * aldrig ser ut som ett sparat val.
 */
export function MunicipalityPicker({
  value,
  onSelect,
}: {
  value: string | null;
  /** Resolves false when the save was refused; the field then shows the saved value again. */
  onSelect: (name: string) => Promise<boolean>;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState(value ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // Sökningen startar först när man skrivit något: att öppna fältet med det
  // sparade namnet i ska visa hela listan, inte bara den ena träffen.
  const [typed, setTyped] = useState(false);

  useEffect(() => {
    setQuery(value ?? '');
  }, [value]);

  const hits = useMemo(() => searchMunicipalities(typed ? query : ''), [query, typed]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);

  function openList() {
    setTyped(false);
    const current = value ? searchMunicipalities('').indexOf(value) : 0;
    setActive(Math.max(0, current));
    setOpen(true);
    // På mobil kan tangentbordet täcka listan; lyft fältet till överkanten.
    if (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches) {
      inputRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    }
  }

  function close() {
    setOpen(false);
    setTyped(false);
    setQuery(value ?? '');
  }

  async function choose(name: string) {
    setOpen(false);
    setTyped(false);
    setQuery(name);
    if (name === value) return;
    const saved = await onSelect(name);
    if (!saved) setQuery(value ?? '');
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) openList();
      else setActive(i => Math.min(hits.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(i => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      if (open && hits[active]) {
        e.preventDefault();
        void choose(hits[active]);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        close();
      }
    }
  }

  const activeId = open && hits[active] ? `${id}-opt-${active}` : undefined;

  return (
    <div className="relative w-full max-w-xs">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label="Hemkommun"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeId}
        autoComplete="off"
        spellCheck={false}
        placeholder="Sök kommun, t.ex. Uppsala"
        className={fieldClass({ className: 'w-full' })}
        value={query}
        onFocus={openList}
        onClick={() => { if (!open) openList(); }}
        onChange={e => {
          setQuery(e.target.value);
          setTyped(true);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        onBlur={close}
      />
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Kommuner"
          className={cardClass('absolute z-10 left-0 right-0 mt-1 max-h-64 overflow-y-auto shadow-pop py-1')}
        >
          {hits.length === 0 ? (
            <li className="px-2.5 py-2 text-xs text-ink-3" role="presentation">
              Inga träffar. Kontrollera stavningen.
            </li>
          ) : hits.map((name, i) => (
            <li
              key={name}
              id={`${id}-opt-${i}`}
              data-index={i}
              role="option"
              aria-selected={name === value}
              // mousedown, inte click: fältets blur stänger listan innan ett click hinner fram.
              onMouseDown={e => { e.preventDefault(); void choose(name); }}
              onMouseEnter={() => setActive(i)}
              className={`flex items-center justify-between px-2.5 py-1.5 text-sm cursor-pointer ${i === active ? 'bg-bg-2' : ''} ${name === value ? 'font-semibold text-ink' : 'text-ink-2'}`}
            >
              {name}
              {name === value && <Check size={14} className="text-acc-deep" aria-hidden="true" />}
            </li>
          ))}
        </ul>
      )}
      <span className="sr-only" aria-live="polite">
        {open && typed ? (hits.length === 0 ? 'Inga träffar' : `${hits.length} träffar`) : ''}
      </span>
    </div>
  );
}
