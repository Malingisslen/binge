'use client';

import { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef, type ReactNode } from 'react';

interface Toast {
  id: number;
  message: string;
}

interface ToastState {
  show: (message: string) => void;
}

const ToastContext = createContext<ToastState>({ show: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const show = useCallback((message: string) => {
    const id = nextId.current++;
    setToasts(prev => [...prev, { id, message }]);
    const timer = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
      timers.current.delete(id);
    }, 2500);
    timers.current.set(id, timer);
  }, []);

  // Rensa eventuella pending timers vid unmount (L5) — undviker setState på en
  // avmonterad provider (StrictMode/tester).
  useEffect(() => {
    const map = timers.current;
    return () => { map.forEach(clearTimeout); map.clear(); };
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2"
        role="region"
        aria-live="polite"
        aria-atomic="true"
      >
        {toasts.map(t => (
          <div
            key={t.id}
            className="bg-ink text-white text-xs px-3 py-2 rounded-sm animate-[fadeIn_0.2s_ease-out]"
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
