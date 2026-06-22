'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';

/**
 * BIN-67 — temahantering. 'system' följer OS (prefers-color-scheme), 'light'/
 * 'dark' tvingar. Persisteras i localStorage (nyckel binge:theme) så att
 * gäster också behåller sitt val. Den faktiska data-theme-attributet sätts
 * redan FÖRE paint av init-scriptet i layout.tsx (static export → ingen
 * server); den här providern äger det löpande tillståndet + togglen och
 * re-applicerar vid ändring och vid OS-skifte.
 */

export type ThemeMode = 'system' | 'light' | 'dark';

const KEY = 'binge:theme';

interface ThemeState {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeState>({ mode: 'system', setMode: () => {} });

function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolveDark(mode: ThemeMode): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return prefersDark();
}

function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  if (resolveDark(mode)) document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
}

function readStored(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  try {
    const s = localStorage.getItem(KEY);
    if (s === 'dark' || s === 'light' || s === 'system') return s;
  } catch { /* tracking-prevention kan kasta → system-fallback */ }
  return 'system';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Lazy-init från localStorage på klienten → matchar init-scriptets beslut,
  // så apply-effekten nedan aldrig flashar fel tema vid mount.
  const [mode, setModeState] = useState<ThemeMode>(readStored);

  useEffect(() => { applyTheme(mode); }, [mode]);

  // OS-skifte ska slå igenom direkt när man kör 'system'.
  useEffect(() => {
    if (mode !== 'system' || typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode]);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    try { localStorage.setItem(KEY, m); } catch { /* ignore */ }
  }, []);

  return <ThemeContext.Provider value={{ mode, setMode }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  return useContext(ThemeContext);
}
