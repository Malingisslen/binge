'use client';

import { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import RatingStars from '@/components/title/RatingStars';

// Valfri åtgärdsknapp i toasten ("Rensa helt", "Ångra" …). Toasts med åtgärd
// lever längre så användaren hinner läsa och välja; klick på knappen kör
// handlern och stänger toasten direkt.
interface ToastAction {
  label: string;
  onClick: () => void;
}

interface Toast {
  id: number;
  message: string;
  actions: ToastAction[];
  onRate?: (rating: number) => void;
}

interface ToastState {
  // Several actions sit side by side ("Ångra" · "Rensa helt"). Pressing any one of them
  // closes the toast, so the others can no longer be pressed after it (BIN-1430).
  show: (message: string, action?: ToastAction | ToastAction[]) => void;
  showRating: (message: string, onRate: (rating: number) => void) => void;
}

const ToastContext = createContext<ToastState>({ show: () => {}, showRating: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback((message: string, action?: ToastAction | ToastAction[]) => {
    const id = nextId.current++;
    const actions = action == null ? [] : Array.isArray(action) ? action : [action];
    setToasts(prev => [...prev, { id, message, actions }]);
    const timer = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
      timers.current.delete(id);
    }, actions.length > 0 ? 6000 : 2500);
    timers.current.set(id, timer);
  }, []);

  // Betygs-toasten: dyker upp när en titel markeras sedd. Lever lika länge som
  // åtgärds-toasts (6 s) så användaren hinner trycka en stjärna; ignoreras den
  // självdör den utan att sätta något betyg (titeln förblir sedd).
  const showRating = useCallback((message: string, onRate: (rating: number) => void) => {
    const id = nextId.current++;
    setToasts(prev => [...prev, { id, message, actions: [], onRate }]);
    const timer = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
      timers.current.delete(id);
    }, 6000);
    timers.current.set(id, timer);
  }, []);

  // Rensa eventuella pending timers vid unmount (L5) — undviker setState på en
  // avmonterad provider (StrictMode/tester).
  useEffect(() => {
    const map = timers.current;
    return () => { map.forEach(clearTimeout); map.clear(); };
  }, []);

  const value = useMemo(() => ({ show, showRating }), [show, showRating]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2"
        role="region"
        aria-label="Aviseringar"
        aria-live="polite"
        // BIN-325: false (not true) so screen readers announce only the newly
        // added toast, not a re-read of the whole stack on every add/remove.
        aria-atomic="false"
      >
        {toasts.map(t => (
          <div
            key={t.id}
            className="bg-ink text-bg text-xs px-3 py-2 rounded-sm animate-[fadeIn_0.2s_ease-out] flex items-center gap-3"
          >
            <span>{t.message}</span>
            {t.onRate && (
              <RatingStars
                rating={null}
                size="md"
                onChange={(n) => { t.onRate!(n); dismiss(t.id); }}
              />
            )}
            {t.actions.map(a => (
              <button
                key={a.label}
                type="button"
                onClick={() => { a.onClick(); dismiss(t.id); }}
                className="text-xs font-semibold underline text-bg bg-transparent border-none cursor-pointer p-0 shrink-0 min-h-[24px]"
              >
                {a.label}
              </button>
            ))}
            {t.onRate && (
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Stäng"
                className="text-bg opacity-60 bg-transparent border-none cursor-pointer p-0 shrink-0"
              >
                <X size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
