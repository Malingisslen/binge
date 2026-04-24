'use client';

import { useEffect, useState } from 'react';

/**
 * Returnerar en epoch-millis-tid som sätts en gång vid mount, `null` innan.
 *
 * Varför: React 19 strict-purity förbjuder `Date.now()` direkt i render,
 * men en `useState + useEffect`-snapshot är accepterat. Använd denna hook
 * när du behöver "ungefär nu" för tidsjämförelser som inte behöver
 * nano-precision (t.ex. "är den här 180+ dagar gammal?").
 *
 * Första render returnerar `null` — hantera som "okänt än" i consuming
 * logic. Efter mount rerendrar komponenten och får siffran.
 */
export function useMountTime(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
  }, []);
  return now;
}
