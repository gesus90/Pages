import { CheckCircle2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import styles from "./toast.module.css";

interface ToastMessage {
  readonly id: number;
  readonly message: string;
}

const SUCCESS_EVENT = "pages:success";

/** Announces a completed client-side action through the single document toaster. */
export function showSuccessToast(message: string): void {
  window.dispatchEvent(new CustomEvent(SUCCESS_EVENT, { detail: message }));
}

function ToastItem({
  toast,
  onDismiss,
}: {
  readonly toast: ToastMessage;
  readonly onDismiss: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(4000);
  useEffect(() => {
    if (hovered || focused) return;
    const started = Date.now();
    const timer = window.setTimeout(onDismiss, remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [hovered, focused, onDismiss]);
  return (
    <div
      role="status"
      className={`flex w-full items-center gap-3 rounded-xl bg-surface px-4 py-3 shadow-panel sm:w-88 ${styles.toast}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false);
      }}
    >
      <CheckCircle2
        className="size-4 shrink-0 text-success"
        aria-hidden="true"
      />
      <p className="flex-1 text-sm font-medium">{toast.message}</p>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("users.reset.close")}
        onClick={onDismiss}
      >
        <X className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

/** Displays up to three nonblocking success notices, pausing dismissal on hover or focus. */
export function Toaster(): React.ReactElement {
  const [messages, setMessages] = useState<readonly ToastMessage[]>([]);
  const nextId = useRef(0);
  useEffect(() => {
    function receive(event: Event): void {
      if (!(event instanceof CustomEvent) || typeof event.detail !== "string")
        return;
      const toast = { id: nextId.current++, message: event.detail };
      setMessages((current) => [...current.slice(-2), toast]);
    }
    window.addEventListener(SUCCESS_EVENT, receive);
    return () => window.removeEventListener(SUCCESS_EVENT, receive);
  }, []);
  return (
    <div className="fixed inset-x-4 bottom-4 z-60 flex flex-col-reverse items-end gap-2 sm:left-auto sm:right-4">
      {messages.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onDismiss={() =>
            setMessages((current) =>
              current.filter((entry) => entry.id !== toast.id),
            )
          }
        />
      ))}
    </div>
  );
}
