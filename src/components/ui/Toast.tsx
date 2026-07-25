'use client';

import { createContext, useCallback, useContext, useRef, useState, ReactNode } from 'react';

interface ToastContextValue {
  showToast: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const VISIBLE_MS = 2500;
const EXIT_MS = 200; // must match .animate-toast-out's duration

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const removeTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const showToast = useCallback((msg: string) => {
    clearTimeout(hideTimerRef.current);
    clearTimeout(removeTimerRef.current);
    setLeaving(false);
    setMessage(msg);
    hideTimerRef.current = setTimeout(() => {
      setLeaving(true);
      removeTimerRef.current = setTimeout(() => {
        setMessage(null);
        setLeaving(false);
      }, EXIT_MS);
    }, VISIBLE_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {message && (
        <div
          className={`fixed bottom-6 left-1/2 z-50 rounded-lg bg-approvedBg px-4 py-2 text-sm font-medium text-approved shadow-md ${
            leaving ? 'animate-toast-out' : 'animate-toast-in'
          }`}
        >
          {message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
