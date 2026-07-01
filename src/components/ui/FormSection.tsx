'use client';

import type { ReactNode } from 'react';

export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="px-3 py-[10px] border-b border-rule-2 last:border-b-0">
      <div className="text-xxs uppercase tracking-[0.5px] text-ink-3 font-semibold mb-[6px]">{title}</div>
      {children}
    </div>
  );
}

export function FormRadioGroup<T extends string>({
  name, value, onChange, options,
}: {
  name: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; desc?: string }[];
}) {
  return (
    <div className="space-y-[3px]">
      {options.map(opt => (
        <label key={opt.value} className="flex items-start gap-2 cursor-pointer text-xs py-[2px]">
          <input
            type="radio"
            name={name}
            value={opt.value}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
            className="accent-acc-deep w-[12px] h-[12px] mt-[2px]"
          />
          <div>
            <div className="text-ink">{opt.label}</div>
            {opt.desc && <div className="text-xxs text-ink-3">{opt.desc}</div>}
          </div>
        </label>
      ))}
    </div>
  );
}
