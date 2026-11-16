import { useEffect, useRef } from "react";

import { useHidePicaLauncher } from "@/app/components/chat/use-pica-launcher-visibility";
import { useCompactScreen } from "@/app/components/chat-page/chat-menu/use-compact-screen";
import { cn } from "@/app/lib/cn";

interface StoragePreviewSurfaceProps {
  readonly label: string;
  readonly onClose: () => void;
  readonly children: React.ReactNode;
}

/** Hides Pica's symbol for as long as it is mounted. */
function PicaLauncherHider(): null {
  useHidePicaLauncher();

  return null;
}

/** Closes the preview with Escape, unless something above it took the key. */
function useEscapeToClose(onClose: () => void): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      // A menu or a search field that handled Escape keeps the preview open.
      if (event.key !== "Escape" || event.defaultPrevented) return;

      event.preventDefault();
      onClose();
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);
}

/** Moves the focus into the preview when it opens, so keys work from the start. */
function useFocusOnOpen(frame: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    frame.current?.focus({ preventScroll: true });
  }, [frame]);
}

/**
 * The frame of the preview.
 * @remarks
 * From 768 px up it is the content card of Storage in place of the list. Below
 * that it fills the screen, safe areas included, above everything else: it is
 * a modal dialog then, and Pica's symbol is hidden so neither the page behind
 * nor the symbol can be operated. Escape closes it at every size.
 */
export function StoragePreviewSurface({
  label,
  onClose,
  children,
}: StoragePreviewSurfaceProps): React.ReactElement {
  const isPhone = useCompactScreen();
  const frame = useRef<HTMLElement | null>(null);

  useEscapeToClose(onClose);
  useFocusOnOpen(frame);

  return (
    <section
      aria-label={label}
      aria-modal={isPhone ? true : undefined}
      className={cn(
        "pages-content-card relative flex min-h-48 min-w-0 flex-1 flex-col overflow-hidden p-0 outline-none",
        "max-md:fixed max-md:inset-0 max-md:z-50 max-md:rounded-none max-md:pt-[env(safe-area-inset-top)] max-md:pb-[env(safe-area-inset-bottom)]",
      )}
      ref={frame}
      role={isPhone ? "dialog" : "region"}
      tabIndex={-1}
    >
      {isPhone ? <PicaLauncherHider /> : null}
      {children}
    </section>
  );
}
