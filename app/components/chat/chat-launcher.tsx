import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import picaIconUrl from "@/assets/pica-icon.svg";

import { ChatPanel } from "./chat-panel";

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
        className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+4rem)] z-40 flex size-14 items-center justify-center rounded-full bg-surface shadow-floating ring-1 ring-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary md:bottom-[calc(env(safe-area-inset-bottom)+1rem)]"
        onClick={handleToggle}
        title={label}
        type="button"
      >
        <img alt="" className="size-11 rounded-full" src={picaIconUrl} />
      </button>
      {isMounted ? <ChatPanel isOpen={isOpen} onClose={handleClose} /> : null}
    </>
  );
}
