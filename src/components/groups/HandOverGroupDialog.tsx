'use client';

import { useEffect, useState } from 'react';
import { UserCheck, X } from 'lucide-react';
import { handOverGroup } from '@/lib/firebase/groupHandover';
import { captureError } from '@/lib/sentry';
import type { GroupMember } from '@/types';

/**
 * BIN-1118 — välj vem som tar över gruppen.
 *
 * Öppnas av knappen "Lämna över" i `GroupSettingsModal`. Malins beslut
 * 2026-09-20: ägaren PEKAR UT sin efterträdare, i två steg, och de kvarvarande
 * medlemmarna får veta. Serverns automatiska val — den som varit med längst —
 * gäller fortfarande kontoraderingens väg och rörs inte.
 *
 * Medlemstiden står bredvid varje namn därför att den är underlaget ägaren har
 * för att välja, och den läses ur `joinedAt` som medlemsraden redan bär. Ingen
 * andra beräkning av medlemsålder införs.
 */
export function HandOverGroupDialog({
  groupId, groupName, candidates, onDone, onCancel,
}: {
  groupId: string;
  groupName: string;
  /** Anroparen filtrerar; den här listan renderas rakt av. */
  candidates: GroupMember[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(candidates[0]?.uid ?? null);
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickedName = candidates.find(m => m.uid === picked)?.displayName ?? '';

  const submit = async () => {
    if (!picked) return;
    setWorking(true);
    setError(null);
    try {
      await handOverGroup(groupId, picked);
    } catch (err) {
      // Serverns läsbara vägran är ett väntat svar till ägaren och rapporteras
      // inte. Allt annat är ett fel som annars bara felrutan hade vetat om.
      if (!isReadableRefusal(err)) {
        captureError(err, { scope: 'groups', kind: 'handOverGroup-write' });
      }
      setError(readableRefusal(err));
      return;
    } finally {
      // Varje väg ut ur dialogen är spärrad på `working` — bakgrunden, Escape,
      // Avbryt och krysset. Ett `working` som inte går tillbaka låser därför
      // dialogen helt, och spärren som skyddar ett pågående anrop blir en fälla.
      // `finally` och inte en rad efter blocket: vägran-grenen returnerar, och en
      // rad efter blocket hade den hoppat över.
      setWorking(false);
    }
    // Skrivningen gick igenom. Knappen får inte bli klickbar igen medan
    // navigeringen pågår: dialogen står kvar monterad tills sidan byts, och ett
    // andra anrop svarar då "Du äger inte den här gruppen" — över ett ägarbyte
    // som redan lyckats. `done` spärrar BARA skicka-knappen; avbrytvägarna följer
    // `working`, så dialogen går fortfarande att stänga om navigeringen faller.
    setDone(true);
    // EFTER den bärande skrivningen, och utanför dess `catch`. Låg `onDone()` kvar
    // inuti blev ett kast från navigeringen rapporterat som att överlämningen
    // misslyckats — över ett ägarbyte som redan gått igenom.
    //
    // Egen fångst, inte ingen fångst: allt efter den bärande skrivningen är
    // bäst-möjliga och rapporteras för sig. Samma form som `LeaveGroupDialog`.
    try {
      onDone();
    } catch (err) {
      console.error('handOverGroup: överlämningen gick igenom, navigeringen inte', err);
      captureError(err, { scope: 'groups', kind: 'handOverGroup-navigation' });
    }
  };

  // `working` och `onCancel` står i beroendena i stället för bakom refs: en
  // ref som skrivs under renderingen underkänns av `react-hooks/refs`, och
  // `ConfirmDialog`s variant — ref satt i en effekt — finns där för att den
  // också flyttar fokus och inte får köra om. Den här lyssnaren rör inte
  // fokus, så en ombindning kostar ingenting.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      if (!working) onCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [working, onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/35 flex items-center justify-center p-4"
      // `stopPropagation`: dialogen renderas som barn till `GroupSettingsModal`s
      // egen bakgrund, som stänger modalen på klick. Utan detta stängde ett
      // bakgrundsklick BÅDA. `ConfirmDialog` slipper det genom att göra exakt detta.
      //
      // `!working`: avbryt-knappen är avstängd medan anropet ligger ute, och
      // bakgrunden är en andra väg till samma avbrott. Stängs dialogen mitt i
      // anropet landar svaret i ett avmonterat träd och den som bad om
      // överlämningen får ingen dom alls — anropet får ta 300 sekunder.
      onClick={e => { e.stopPropagation(); if (!working) onCancel(); }}
      role="presentation"
    >
      <div
        className="bg-surface border border-rule rounded-md w-full max-w-[420px] overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="handover-title"
      >
        <div className="px-3 py-2 border-b border-rule flex items-center justify-between">
          <h2 id="handover-title" className="text-sm font-bold">Välj vem som tar över gruppen</h2>
          {/*
            En väg ut bland flera, och den satt ogrindad medan de andra bar
            `!working`. Krysset ligger i den inre rutan, vars `onClick` stoppar
            vidarebefordran, så det når aldrig den grindade bakgrunden. Ett klick
            mitt i anropet avmonterade dialogen, och ett serverfel efteråt hade
            då ingenstans att visa sig: ägaren fick ingen dom alls. Härled
            vägarna: `grep -n "onCancel\b" src/components/groups/HandOverGroupDialog.tsx`
          */}
          <button
            onClick={onCancel}
            disabled={working}
            aria-label="Stäng överlämning"
            className="text-ink-3 hover:text-ink-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-3 py-3">
          <p className="text-xs text-ink-3 mb-2">Steg 2 av 2 · {groupName}</p>

          <ul className="mb-3">
            {candidates.map(m => (
              <li key={m.uid} className="border-b border-rule-2 last:border-b-0">
                <label className="flex items-center gap-2 py-[6px] cursor-pointer text-xs">
                  <input
                    type="radio"
                    name="handover-successor"
                    value={m.uid}
                    checked={picked === m.uid}
                    onChange={() => setPicked(m.uid)}
                    className="accent-acc-deep"
                  />
                  <span className="flex-1">{m.displayName}</span>
                  <span className="text-ink-3">{memberSince(m)}</span>
                </label>
              </li>
            ))}
          </ul>

          <div className="bg-danger-soft border border-danger/30 rounded-sm px-3 py-2 text-xs text-danger-ink">
            Du slutar vara ägare och lämnar gruppen. Personen du väljer blir ny ägare
            och kan bland annat radera gruppen. Alla medlemmar får se att ägaren bytts.
          </div>

          {error && (
            <div className="mt-2 px-3 py-2 text-xs text-danger-ink bg-danger-soft border border-danger/30 rounded-sm">
              {error}
            </div>
          )}
        </div>

        <div className="px-3 py-2 border-t border-rule-2 flex items-center gap-2">
          <button
            onClick={onCancel}
            disabled={working}
            className="px-3 py-[5px] border border-rule rounded-sm text-xs bg-white cursor-pointer disabled:opacity-50"
          >
            Avbryt
          </button>
          <button
            onClick={submit}
            disabled={working || done || !picked}
            className="ml-auto inline-flex items-center gap-1 px-3 py-[5px] border border-danger/40 text-danger-ink rounded-sm text-xs bg-white cursor-pointer hover:bg-danger-soft disabled:opacity-50"
          >
            <UserCheck size={11} />
            {working ? 'Lämnar över…' : `Lämna över till ${pickedName}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Serverns vägran, eller en svensk mening när felet inte är en sådan.
 *
 * Bara `failed-precondition` bär text skriven för en läsare — det är koden
 * `handOverGroup` kastar för sina egna vägransfall, och de är formulerade på
 * svenska. Allt annat som når hit är ett `FirebaseError`: nätet, App Check, en
 * funktion som inte är driftsatt. Deras `message` är en teknisk engelsk sträng,
 * och eftersom de ÄR `Error` hade en enkel `err.message` visat just den för den
 * som står och väntar.
 */
function readableRefusal(err: unknown): string {
  if (isReadableRefusal(err)) return err.message;
  return 'Överlämningen gick inte igenom. Försök igen.';
}

function isReadableRefusal(err: unknown): err is Error {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 'functions/failed-precondition' && err instanceof Error && !!err.message;
}

/**
 * "medlem sedan mars 2024". Månad och år, inte en dagsexakt tid: ägaren väljer
 * mellan personer, inte mellan datum, och en exakt tidsstämpel läser som
 * precision underlaget inte bär.
 *
 * En rad utan användbar tidsstämpel säger att den inte vet. Den får annars dagens
 * datum av `toDate` och skulle läsas som den NYASTE medlemmen — motsatsen till
 * hur servern rankar samma rad när den väljer efterträdare själv.
 */
function memberSince(member: GroupMember): string {
  if (!member.joinedAtKnown) return 'medlemstid okänd';
  return `medlem sedan ${member.joinedAt.toLocaleDateString('sv-SE', { year: 'numeric', month: 'long' })}`;
}
