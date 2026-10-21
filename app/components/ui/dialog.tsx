import * as DialogPrimitive from "@radix-ui/react-dialog";

import { cn } from "@/app/lib/cn";

import { ScrollViewport } from "./scroll-viewport";

import type { ComponentProps, ReactNode } from "react";

export const Dialog = DialogPrimitive.Root;
export const DialogClose = DialogPrimitive.Close;
export const DialogDescription = DialogPrimitive.Description;
export const DialogTitle = DialogPrimitive.Title;
export const DialogTrigger = DialogPrimitive.Trigger;

interface DialogContentProps extends ComponentProps<
  typeof DialogPrimitive.Content
> {
  readonly children: ReactNode;
  readonly size?: "sm" | "md" | "lg";
}

const DIALOG_WIDTHS = {
  sm: "w-[min(26rem,92vw)]",
  md: "w-[min(32rem,92vw)]",
  lg: "w-[min(38rem,92vw)]",
} as const;

/** Renders a centered Pages modal and its accessible overlay. */
export function DialogContent({
  children,
  className,
  size = "sm",
  ...properties
}: DialogContentProps): React.ReactElement {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-scrim data-[state=closed]:animate-out data-[state=open]:animate-in" />
      <DialogPrimitive.Content asChild {...properties}>
        <ScrollViewport
          containerClassName={cn(
            "fixed top-1/2 left-1/2 z-50 max-h-[90dvh] -translate-x-1/2 -translate-y-1/2",
            DIALOG_WIDTHS[size],
            className
              ?.split(/\s+/)
              .filter((token) => /^(?:min-|max-)?[hw]-/.test(token)),
          )}
          className={cn(
            "rounded-2xl bg-surface p-6 shadow-panel outline-none",
            className,
          )}
        >
          {children}
        </ScrollViewport>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
