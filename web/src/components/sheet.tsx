"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Single bottom sheet, Ranktasy-style: content is a prop, the shell is one
 * implementation (grip, blurred overlay, slide-up, Escape/overlay close).
 */
export function Sheet({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setMounted(true);
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
      hideTimer.current = setTimeout(() => setMounted(false), 320);
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <div className={`sheet-ov ${open ? "show" : ""}`} onClick={onClose}>
      <div
        className={`sheet ${open ? "show" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="grip" />
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3.5 right-3.5 bg-surface border border-line2 text-muted w-8 h-8 rounded-[9px] cursor-pointer text-sm transition-colors hover:text-ink hover:border-home"
        >
          ✕
        </button>
        {children}
      </div>
    </div>
  );
}
