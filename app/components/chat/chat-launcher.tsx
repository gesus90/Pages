import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { ChatPanel } from "./chat-panel";
import { PicaMascot } from "./pica-mascot";

/**
 * Pica's symbol at the bottom right of every page (T6.12.1, T6.12.15); it
 * shows and hides the floating chat panel.
 *
 * @remarks
 * The panel is mounted on first use and then only hidden, so the server
 * renders just the button and nothing is loaded before the person opens it.
 */
export function ChatLauncher(): React.ReactElement {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null);

  function handleToggle(): void {
    setIsMounted(true);
    setIsOpen((current) => !current);
  }

  function handleClose(): void {
    setIsOpen(false);
    launcher.current?.focus();
  }

  const label = t(isOpen ? "chat.close" : "chat.open");

  return (
    <>
      <button
        ref={launcher}
        aria-controls="pica-chat"
        aria-expanded={isOpen}
        aria-label={label}
        className={cn(
          "fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+4rem)] z-40 flex size-14 items-center justify-center rounded-full border-2 border-primary bg-surface shadow-floating transition-colors hover:border-primary-hover hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:border-primary-hover active:bg-muted md:bottom-[calc(env(safe-area-inset-bottom)+1rem)]",
          isOpen && "ring-2 ring-primary/25 ring-offset-2 ring-offset-surface",
        )}
        onClick={handleToggle}
        title={label}
        type="button"
      >
        {/* Center the visible SVG bounds (including the wave), whose midpoint is about (329, 335) on its 640-square canvas; the smaller size keeps clear of the orange ring. */}
        <PicaMascot className="size-9 -translate-x-[1.5%] -translate-y-[2.35%]" />
      </button>
      {isMounted ? <ChatPanel isOpen={isOpen} onClose={handleClose} /> : null}
    </>
  );
}
