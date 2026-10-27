"use client";

import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type AppConfig } from "@/src/ui/lib/api";
import styles from "./Providers.module.css";

/* ---------- Server config (one fetch per page load, shared) ---------- */

interface ConfigState {
  config: AppConfig | null;
  failed: boolean;
}
const ConfigContext = createContext<ConfigState>({ config: null, failed: false });
export const useConfig = () => useContext(ConfigContext);

/* ---------- Toasts ---------- */

export type ToastTone = "ok" | "bad" | "info";
interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
}
interface ToastApi {
  push: (t: Omit<Toast, "id">) => void;
}
const ToastContext = createContext<ToastApi>({ push: () => undefined });
export const useToast = () => useContext(ToastContext);

export function Providers({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ConfigState>({ config: null, failed: false });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    let alive = true;
    api<AppConfig>("/api/config")
      .then((c) => alive && setConfig({ config: c, failed: false }))
      .catch(() => alive && setConfig({ config: null, failed: true }));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
  }, []);

  const push = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-3), { ...t, id }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), t.tone === "bad" ? 8000 : 3800),
      );
    },
    [dismiss],
  );
  const toastApi = useMemo(() => ({ push }), [push]);

  return (
    <ConfigContext.Provider value={config}>
      <ToastContext.Provider value={toastApi}>
        {children}
        <div className={`${styles.toasts} no-print`} role="region" aria-label="Notifications">
          <div aria-live="polite" aria-atomic="false" className={styles.stack}>
            {toasts.map((t) => (
              <div key={t.id} className={`${styles.toast} ${styles[t.tone]}`} role={t.tone === "bad" ? "alert" : "status"}>
                <span className={styles.icon} aria-hidden>
                  {t.tone === "ok" ? <CheckCircle2 /> : t.tone === "bad" ? <CircleAlert /> : <Info />}
                </span>
                <div className={styles.text}>
                  <strong>{t.title}</strong>
                  {t.body && <span>{t.body}</span>}
                </div>
                <button type="button" className={styles.close} onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
                  <X />
                </button>
              </div>
            ))}
          </div>
        </div>
      </ToastContext.Provider>
    </ConfigContext.Provider>
  );
}
