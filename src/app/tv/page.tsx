'use client';

import { Suspense, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Tv } from 'lucide-react';
import AuthGuard from '@/components/AuthGuard';
import { usePageMeta } from '@/hooks/usePageMeta';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoadingView } from '@/components/ui/LoadingView';
import { Button, buttonClass } from '@/components/ui/Button';
import { cardClass } from '@/components/ui/Card';
import { fieldClass } from '@/components/ui/Field';
import { approveTvPairing, tvPairErrorMessage } from '@/lib/firebase/tvPairing';
import { cleanTvCode, groupTvCode, parseTvCode, TV_CODE_LENGTH } from '@/lib/tvPairingCode';

export default function TvPairPage() {
  return (
    <AuthGuard>
      <Suspense fallback={<LoadingView label="Laddar…" />}>
        <TvPairContent />
      </Suspense>
    </AuthGuard>
  );
}

function TvPairContent() {
  usePageMeta({ title: 'Koppla din TV' });
  const router = useRouter();
  const fromQr = parseTvCode(useSearchParams().get('kod'));
  const [typed, setTyped] = useState<string | null>(null);
  const code = fromQr ?? typed;
  const chooseAnother = () => {
    setTyped(null);
    if (fromQr) router.replace('/tv/');
  };

  return (
    <>
      <PageHeader crumb="Inställningar" title="Koppla din TV" />
      <div className="mt-7 max-w-md">
        {code
          ? <ConfirmPairing code={code} onChooseAnother={chooseAnother} />
          : <EnterCode onSubmit={setTyped} />}
      </div>
    </>
  );
}

function EnterCode({ onSubmit }: { onSubmit: (code: string) => void }) {
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const code = parseTvCode(value);
    if (code) onSubmit(code);
    else setInvalid(true);
  };

  return (
    <form onSubmit={submit} className={cardClass('p-4 flex flex-col gap-3')}>
      <p className="text-sm text-ink-2">Skriv koden som visas på TV-skärmen.</p>
      <input
        type="text"
        value={value}
        onChange={e => { setValue(cleanTvCode(e.target.value).slice(0, TV_CODE_LENGTH)); setInvalid(false); }}
        aria-label="Kod från TV:n"
        aria-invalid={invalid}
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        maxLength={TV_CODE_LENGTH + 1}
        className={fieldClass({ className: 'tracking-widest' })}
      />
      {invalid && <p role="alert" className="text-xs text-danger-ink">Koden ser inte rätt ut. Kontrollera den på TV:n.</p>}
      <p className="text-xs text-ink-3">Koden gäller i 1 minut.</p>
      <div>
        <Button type="submit" variant="acc">Fortsätt</Button>
      </div>
    </form>
  );
}

function ConfirmPairing({ code, onChooseAnother }: { code: string; onChooseAnother: () => void }) {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);

  const approve = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await approveTvPairing(code);
      setDeviceName(res.deviceName);
    } catch (err) {
      setError(tvPairErrorMessage(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  if (deviceName !== null) {
    return (
      <div className={cardClass('p-4 flex flex-col gap-3')}>
        <div className="flex items-center gap-3">
          <TvIconBox />
          <div className="min-w-0">
            <h2 className="text-md font-bold text-ink">TV:n är kopplad</h2>
            <p className="text-sm text-ink-2 truncate">{deviceName}</p>
          </div>
        </div>
        <div>
          <Link href="/settings/#tjanster" className={buttonClass({ variant: 'ghost', size: 'sm' })}>
            Hantera i Inställningar
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={cardClass('p-4 flex flex-col gap-3')}>
      <div className="flex items-center gap-3">
        <TvIconBox />
        <h2 className="text-md font-bold text-ink">Koppla Google TV?</h2>
      </div>
      <p className="text-sm text-ink-2">Stämmer koden med den på TV:n?</p>
      <p className="text-3xl font-bold text-ink tracking-widest" aria-label={`Kod ${groupTvCode(code)}`}>
        {groupTvCode(code)}
      </p>
      <p className="text-sm text-ink bg-acc-soft border border-rule rounded-sm px-3 py-2">
        Godkänn bara om TV:n står framför dig.
      </p>
      <ul className="text-xs text-ink-2 list-disc pl-4 flex flex-col gap-1">
        <li>TV:n visar din Vill se, kalender och nästa avsnitt.</li>
        <li>Alla som tittar på TV:n ser dem.</li>
        <li>Du kan koppla bort den när som helst i Inställningar.</li>
      </ul>
      {error && <p role="alert" className="text-xs text-danger-ink">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="button" variant="acc" onClick={approve} disabled={busy}>
          {busy ? 'Godkänner…' : 'Godkänn'}
        </Button>
        <Link href="/settings/" className={buttonClass({ variant: 'ghost' })}>Avbryt</Link>
      </div>
      {error && (
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={onChooseAnother} disabled={busy}>Ange annan kod</Button>
        </div>
      )}
    </div>
  );
}

function TvIconBox() {
  return (
    <span className="shrink-0 w-10 h-10 rounded-md border border-rule bg-bg-2 text-ink-2 flex items-center justify-center" aria-hidden>
      <Tv size={20} />
    </span>
  );
}
