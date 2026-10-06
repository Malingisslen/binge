import type { ReactNode } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Button, buttonClass } from '@/components/ui/Button';
import StatCard from '@/components/ui/StatCard';
import DuotonePoster from '@/components/ui/DuotonePoster';
import { DUOTONES } from '@/lib/duotone';

// The living component page: every piece is the real component or CSS class, so the
// page changes when they do. Both themes side by side, whatever theme the viewer runs.

const COLOR_TOKENS = [
  'bg', 'bg-2', 'surface', 'ink', 'ink-2', 'ink-3', 'rule', 'rule-2',
  'acc', 'acc-deep', 'acc-soft', 'cal-deep', 'cal-soft',
  'warn-soft', 'warn-deep', 'danger', 'danger-soft', 'success', 'season-done',
] as const;

// Class names spelled out in full so Tailwind's content scan generates them.
const TYPE_SCALE = [
  ['text-6xl', '48px'], ['text-5xl', '32px'], ['text-4xl', '24px'], ['text-3xl', '22px'],
  ['text-2xl', '20px'], ['text-xl', '17px'], ['text-lg', '15.5px'], ['text-md', '14px'],
  ['text-base', '13.5px'], ['text-sm', '12.5px'], ['text-xs', '11px'], ['text-xxs', '10px'],
  ['text-micro', '9px'], ['text-nano', '8px'],
] as const;

// A plain gradient stands in for a poster, so the page needs no network.
const POSTER_SRC =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient></defs><rect width="200" height="300" fill="url(#g)"/><circle cx="100" cy="120" r="50" fill="#888"/></svg>',
  );

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-rule pt-4">
      <Eyebrow as="h2" size="xs">{title}</Eyebrow>
      {children}
    </section>
  );
}

function Specimen({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <div data-theme={theme} className="bg-bg text-ink border border-rule rounded-md p-5 flex flex-col gap-6 min-w-0">
      <Eyebrow size="xs">{theme === 'light' ? 'Ljust läge' : 'Mörkt läge'}</Eyebrow>

      <Section title="Färger">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
          {COLOR_TOKENS.map(t => (
            <div key={t} className="flex flex-col gap-1">
              <div className="h-8 rounded-sm border border-rule" style={{ background: `var(--${t})` }} />
              <span className="text-xxs text-ink-2">{t}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Typskala">
        <div className="flex flex-col gap-1">
          {TYPE_SCALE.map(([cls, px]) => (
            <div key={cls} className="flex items-baseline gap-3 min-w-0">
              <span className="text-xxs text-ink-3 w-20 shrink-0 tabular-nums">{cls.replace('text-', '')} · {px}</span>
              <span className={`${cls} truncate`}>Se vad du betalar</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Ögonbryn">
        <Eyebrow>Kommande 6 månader</Eyebrow>
        <Eyebrow size="xs">Dina pausade tjänster</Eyebrow>
      </Section>

      <Section title="Knappar">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="acc">Spara</Button>
          <Button type="button">Standard</Button>
          <Button type="button" variant="ghost">Avbryt</Button>
          <Button type="button" variant="danger">Ta bort</Button>
          <Button type="button" variant="danger-ghost">Lämna</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="acc" size="sm">Liten</Button>
          <Button type="button" variant="ghost" size="sm">Liten ghost</Button>
          <Button type="button" variant="acc" size="sm" disabled className="disabled:opacity-50">Avstängd</Button>
          <a href="#knappar" className={buttonClass({ variant: 'ghost', size: 'sm', className: 'no-underline' })}>Länk som knapp</a>
        </div>
      </Section>

      <Section title="Chips">
        <div className="flex flex-wrap gap-2">
          <span className="chip">Netflix</span>
          <span className="chip acc">Live nu</span>
          <span className="chip is-on">Vald</span>
          <span className="chip"><span className="dot" />Med prick</span>
        </div>
      </Section>

      <Section title="Kort">
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Sparat i år" value="1 284 kr" />
          <div className="border border-rule rounded-sm bg-surface p-3">
            <Eyebrow className="mb-1">Kort</Eyebrow>
            <p className="text-sm text-ink-2">border-rule, rounded-sm, bg-surface</p>
          </div>
        </div>
      </Section>

      <Section title="Sidhuvud">
        <PageHeader
          crumb="Bibliotek"
          title="Mina serier"
          standfirst="Allt du följer, sorterat efter nästa avsnitt."
          actions={<Button type="button" variant="acc" size="sm">Lägg till</Button>}
        />
      </Section>

      <Section title="Tomt tillstånd">
        <EmptyState title="Inga listor ännu" body="Skapa din första lista och dela den med en vän." />
      </Section>

      <Section title="Duotone">
        <div className="grid grid-cols-4 gap-2">
          {DUOTONES.map(tone => (
            <div key={tone} className="flex flex-col gap-1">
              <DuotonePoster src={POSTER_SRC} alt="" tone={tone} />
              <span className="text-xxs text-ink-2">{tone}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

export default function DesignsystemPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumb="Internt"
        title="Designsystemet"
        standfirst="Binges färger, typskala och komponenter, i ljust och mörkt läge. Bygg nya sidor av delarna här."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Specimen theme="light" />
        <Specimen theme="dark" />
      </div>
    </div>
  );
}
