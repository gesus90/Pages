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
  readonly overlayClassName?: string;
  readonly size?: "sm" | "md" | "lg";
}

const DIALOG_WIDTHS = {
  sm: "w-[min(26rem,92vw)]",
  md: "w-[min(32rem,92vw)]",
  lg: "w-[min(38rem,92vw)]",
} as const;

// The shell carries radius, fill and shadow and clips the viewport; the
// scrolling viewport carries none of them, so its scrollbar never paints
// square over a rounded corner.
const DIALOG_SHELL_CLASS =
  "fixed top-1/2 left-1/2 z-50 max-h-[90dvh] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-surface shadow-panel";
const DIALOG_VIEWPORT_CLASS = "p-6 outline-none";

/** Size utilities a caller sets; the shell and the viewport both take them. */
const SIZE_UTILITY = /^(?:min-|max-)?[hw]-/;

/** Surface utilities a caller sets; only the shell takes them. */
const SURFACE_UTILITY = /^(?:rounded|bg-|shadow|ring)/;

/** The caller's classes of the shell and of the scrolling viewport. */
interface DialogClassNames {
  readonly shell: readonly string[];
  readonly viewport: readonly string[];
}

/**
 * Splits a caller's classes between the shell and the viewport.
 * @param className - The classes a caller passes to `DialogContent`.
 * @returns Size and surface classes for the shell, all others and the size
 * classes for the viewport.
 */
function splitDialogClassName(className: string | undefined): DialogClassNames {
  const tokens = className?.split(/\s+/).filter(Boolean) ?? [];
  return {
    shell: tokens.filter(
      (token) => SIZE_UTILITY.test(token) || SURFACE_UTILITY.test(token),
    ),
    viewport: tokens.filter((token) => !SURFACE_UTILITY.test(token)),
  };
}

/**
 * Renders a centered Pages modal and its accessible overlay.
 * @remarks
 * The modal is a scroll shell: size, radius, fill, ring and shadow classes of
 * `className` go to the clipping shell, all others to the scrolling viewport.
 */
export function DialogContent({
  children,
  className,
  size = "sm",
  overlayClassName,
  ...properties
}: DialogContentProps): React.ReactElement {
  const classNames = splitDialogClassName(className);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          "fixed inset-0 z-40 bg-scrim data-[state=closed]:animate-out data-[state=open]:animate-in",
          overlayClassName,
        )}
      />
      <DialogPrimitive.Content asChild {...properties}>
        <ScrollViewport
          isShell
          fadeMode="mask"
          containerClassName={cn(
            DIALOG_SHELL_CLASS,
            DIALOG_WIDTHS[size],
            classNames.shell,
          )}
          className={cn(DIALOG_VIEWPORT_CLASS, classNames.viewport)}
        >
          {children}
        </ScrollViewport>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
