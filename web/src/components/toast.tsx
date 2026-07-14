"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  type ReactNode,
} from "react";

const ToastContext = createContext<(msg: string) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((msg: string) => {
    const el = ref.current;
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => el.classList.remove("show"), 2600);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div id="toast" ref={ref} role="status" aria-live="polite" />
    </ToastContext.Provider>
  );
}
