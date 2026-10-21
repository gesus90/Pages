import * as DialogPrimitive from "@radix-ui/react-dialog";

import { cn } from "@/app/lib/cn";

import { ScrollViewport } from "./scroll-viewport";

import type { ComponentProps, ReactNode } from "react";

export const Sheet = DialogPrimitive.Root;
export const SheetClose = DialogPrimitive.Close;
export const SheetTitle = DialogPrimitive.Title;
export const SheetTrigger = DialogPrimitive.Trigger;

interface SheetContentProps extends ComponentProps<
  typeof DialogPrimitive.Content
> {
  readonly children: ReactNode;
}

/** Renders the left-side mobile navigation sheet and its accessible overlay. */
export function SheetContent({
  children,
  className,
  ...properties
}: SheetContentProps): React.ReactElement {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-scrim-drawer data-[state=closed]:animate-out data-[state=open]:animate-in" />
      <DialogPrimitive.Content asChild {...properties}>
        <ScrollViewport
          containerClassName="fixed inset-y-0 left-0 z-50 w-[min(19rem,86vw)]"
          className={cn(
            "flex flex-col bg-surface p-5 shadow-panel outline-none",
            className,
          )}
        >
          {children}
        </ScrollViewport>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
