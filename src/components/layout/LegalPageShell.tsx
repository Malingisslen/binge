import type { ReactNode } from 'react';

interface LegalPageShellProps {
  title: string;
  lastUpdated: string;
  version: string;
  draft?: boolean;
  children: ReactNode;
}

export default function LegalPageShell({
  title,
  lastUpdated,
  version,
  draft = false,
  children,
}: LegalPageShellProps) {
  return (
    <article className="max-w-[720px] mx-auto py-6 px-2">
      <header className="mb-6 pb-4 border-b border-rule-2">
        <h1 className="text-[22px] font-bold text-ink mb-2">{title}</h1>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xxs text-ink-3">
          <span>Senast uppdaterad: {lastUpdated}</span>
          <span>Version: {version}</span>
        </div>
        {draft && (
          <div className="mt-3 p-3 bg-warn-soft border border-warn-deep rounded-sm text-xs text-warn-ink">
            <strong>Utkast.</strong> Detta dokument är ett arbetsutkast.
            Det speglar Binges faktiska hantering men har ännu inte
            genomgått formell juridisk granskning.
          </div>
        )}
      </header>
      <div className="prose-like text-sm leading-relaxed text-ink space-y-4 [&>h2]:text-md [&>h2]:font-bold [&>h2]:mt-6 [&>h2]:mb-2 [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:mt-4 [&>h3]:mb-1 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1 [&_a]:text-acc-deep [&_a]:underline [&_a:hover]:no-underline">
        {children}
      </div>
    </article>
  );
}
