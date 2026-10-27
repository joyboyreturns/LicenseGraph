"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import styles from "./Drawer.module.css";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A side sheet dialog: traps focus, closes on Escape or backdrop, and gives focus back to its opener. */
export function Drawer({ open, onClose, title, subtitle, children, width = 760 }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; width?: number }) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const el = panel.current;
    const first = el?.querySelector<HTMLElement>("[data-autofocus]") ?? el?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus({ preventScroll: true });
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
      if (!items.length) return;
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      if (opener.current instanceof HTMLElement) opener.current.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className={styles.root}>
      <div className={styles.backdrop} onClick={onClose} aria-hidden />
      <div ref={panel} className={styles.panel} role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ maxWidth: width }}>
        <header className={styles.head}>
          <div className={styles.titles}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
          </div>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label="Close">
            <X aria-hidden />
          </button>
        </header>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
