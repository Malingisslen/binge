import type { ReactNode } from 'react';

/**
 * Delad wrapper för settings-sektioner som inte är collapsible. Gemensam
 * visuell struktur: bg-surface-card med header-band + body-padding.
 *
 * `tone: 'danger'` använder röd border + röd header-text (för
 * DeleteAccountSection).
 */
export function SettingsCard({
  title,
  tone = 'default',
  children,
}: {
  title: string;
  tone?: 'default' | 'danger';
  children: ReactNode;
}) {
  const borderClass = tone === 'danger' ? 'border-red-200' : 'border-border-main';
  const headerBorderClass = tone === 'danger' ? 'border-red-100' : 'border-border-light';
  const titleClass = tone === 'danger' ? 'text-red-600' : 'text-text-secondary';

  return (
    <div className={`bg-surface border ${borderClass} rounded-sm mb-[14px]`}>
      <div className={`px-3 py-[6px] border-b ${headerBorderClass}`}>
        <span className={`text-sm font-bold ${titleClass}`}>{title}</span>
      </div>
      <div className="px-3 py-2">{children}</div>
    </div>
  );
}
