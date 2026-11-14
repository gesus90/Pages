import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import styles from "../toast.module.css";
import { ToastContent, ToastSymbol } from "./toast-content";
import { useToastLifetime } from "./use-toast-lifetime";

import type { ToastMessage } from "./toast-types";

interface ToastItemProps {
  readonly toast: ToastMessage;
  readonly onDismiss: () => void;
}

/** One animated and keyboard-accessible notice with a pausable lifetime. */
export function ToastItem({
  toast,
  onDismiss,
}: ToastItemProps): React.ReactElement {
  const { t } = useTranslation();
  const lifetime = useToastLifetime(toast, onDismiss);
  const isError = toast.type === "error";
  function handleAction(): void {
    onDismiss();
    toast.action?.onClick();
  }
  return (
    <div
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      aria-atomic="true"
      className={cn(
        "pointer-events-auto flex w-full items-start gap-3 rounded-xl bg-surface px-4 py-3 text-foreground shadow-panel",
        styles.toast,
        lifetime.isLeaving && styles.leaving,
      )}
      onMouseEnter={() => lifetime.setHovered(true)}
      onMouseLeave={() => lifetime.setHovered(false)}
      onFocus={() => lifetime.setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          lifetime.setFocused(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        lifetime.dismiss();
      }}
    >
      <ToastSymbol toast={toast} />
      <div className="min-w-0 flex-1">
        <ToastContent toast={toast} />
        {toast.action ? (
          <button
            type="button"
            onClick={handleAction}
            className="mt-1 rounded-sm text-[13px] leading-4.5 font-semibold text-toast-action outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {toast.action.label}
          </button>
        ) : null}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        className="-mt-1 -mr-2 shrink-0 text-muted-foreground"
        aria-label={t("toast.close")}
        onClick={lifetime.dismiss}
      >
        <X className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
