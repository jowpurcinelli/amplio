import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type ToastKind = "ok" | "err";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  ok: (message: string) => void;
  err: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Fire-and-forget notifications for actions like save and delete. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const api = useRef<ToastApi>({
    ok: (m) => push("ok", m),
    err: (m) => push("err", m),
  }).current;

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-host" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} role="status">
            <span className="toast-dot" />
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
