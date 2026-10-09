import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/app/components/ui/button";
import styles from "./side-panel.module.css";

import type { ComponentProps, ReactNode } from "react";

interface SidePanelContentProps {
  readonly title: string;
  readonly closeLabel: string;
  readonly children: ReactNode;
  /** Controlled forms can reset their dirty state after an in-panel save. */
  readonly hasUnsavedChanges?: boolean;
  /** Restores focus for panels opened from several table or menu triggers. */
  readonly onCloseAutoFocus?: ComponentProps<
    typeof DialogPrimitive.Content
  >["onCloseAutoFocus"];
}

/** Accessible management panel with the shared Pages surface and fixed header. */
export function SidePanelContent({
  title,
  closeLabel,
  children,
  hasUnsavedChanges,
  onCloseAutoFocus,
}: SidePanelContentProps): React.ReactElement {
  const { t } = useTranslation();
  const content = useRef<HTMLDivElement>(null);
  const hasChanges = useRef(false);
  function allowDismissal(): boolean {
    if (
      !(hasUnsavedChanges ?? hasChanges.current) ||
      !content.current?.querySelector("form")
    )
      return true;
    if (!window.confirm(t("users.discardChanges"))) return false;
    hasChanges.current = false;
    return true;
  }
  function handleDismiss(event: { preventDefault: () => void }): void {
    if (!allowDismissal()) event.preventDefault();
  }
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={`fixed inset-x-0 top-19 bottom-0 z-30 bg-foreground/15 ${styles.backdrop}`}
      />
      <DialogPrimitive.Content
        ref={content}
        onCloseAutoFocus={onCloseAutoFocus}
        onChangeCapture={() => {
          hasChanges.current = true;
        }}
        onEscapeKeyDown={handleDismiss}
        onInteractOutside={handleDismiss}
        onClickCapture={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest("[data-panel-dismiss]")
          )
            handleDismiss(event);
        }}
        className={`pages-floating-panel fixed top-20 right-4 bottom-4 z-40 flex w-[min(38rem,92vw)] flex-col bg-surface ${styles.panel}`}
        aria-describedby={undefined}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 px-6 pt-5 pb-4">
          <DialogPrimitive.Title className="text-base font-semibold">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Close asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={closeLabel}
              data-panel-dismiss
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </DialogPrimitive.Close>
        </header>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
