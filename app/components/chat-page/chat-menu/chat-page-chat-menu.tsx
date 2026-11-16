import { Menu } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";

import { ChatMenuDropdownItems } from "./chat-menu-dropdown";
import { ChatMenuSheet } from "./chat-menu-sheet";
import { useCompactScreen } from "./use-compact-screen";

import type { ChatMenuModel } from "./chat-menu-model";
import type { ChatMenuPoint } from "./chat-menu-request";

/** The quiet ☰ of the head; open, it stands out in the light accent. */
const TRIGGER_CLASS =
  "text-muted-foreground hover:bg-primary-subtle hover:text-primary aria-expanded:bg-primary-subtle aria-expanded:text-primary data-[state=open]:bg-primary-subtle data-[state=open]:text-primary";

const CONTENT_CLASS = "w-80";

interface ChatPageChatMenuProps {
  readonly model: ChatMenuModel;
  /** Tells that the menu opened by its button, so entries read their data anew. */
  readonly onOpen?: () => void;
  /** The point a right click or long press in the list opens the menu at; `null` while none does. */
  readonly anchor: ChatMenuPoint | null;
  /** Ends the request of the list once its menu closes. */
  readonly onAnchorClose: () => void;
}

/**
 * The opened menu at the point of a right click in the list: an invisible
 * point of one pixel serves as its trigger, so Radix places the menu there.
 * It leaves the list usable, so a right click on another chat moves it.
 */
function AnchoredMenu({
  model,
  point,
  onClose,
}: {
  readonly model: ChatMenuModel;
  readonly point: ChatMenuPoint;
  readonly onClose: () => void;
}): React.ReactElement {
  return (
    <DropdownMenu
      open
      modal={false}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden="true"
          className="pointer-events-none fixed size-px"
          data-chat-menu-anchor=""
          style={{ left: point.x, top: point.y }}
          tabIndex={-1}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className={CONTENT_CLASS}
        collisionPadding={8}
        sideOffset={2}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <ChatMenuDropdownItems model={model} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The menu ☰ at the right edge of the head of every chat, with
 * all settings and actions of the chat.
 * @remarks
 * On a screen from `md` on it opens as a dropdown below the button, and at
 * the mouse when a right click or a long press in the list asks for it; on
 * a phone it opens as a sheet from the bottom. All variants show the same
 * {@link ChatMenuModel}.
 */
export function ChatPageChatMenu({
  model,
  onOpen,
  anchor,
  onAnchorClose,
}: ChatPageChatMenuProps): React.ReactElement {
  const { t } = useTranslation();
  const isCompact = useCompactScreen();
  const [isOpen, setIsOpen] = useState(false);

  function handleOpenChange(next: boolean): void {
    setIsOpen(next);
    if (next) onOpen?.();
  }

  const trigger = (
    <Button
      aria-label={t("chatPage.chatMenu.label")}
      aria-haspopup="menu"
      aria-expanded={isOpen}
      className={TRIGGER_CLASS}
      data-chat-menu-trigger=""
      size="icon-sm"
      type="button"
      variant="ghost"
      onClick={isCompact ? () => handleOpenChange(true) : undefined}
    >
      <Menu aria-hidden="true" className="size-4" strokeWidth={1.75} />
    </Button>
  );

  if (isCompact)
    return (
      <>
        {trigger}
        <ChatMenuSheet
          model={model}
          isOpen={isOpen || anchor !== null}
          onOpenChange={(next) => {
            handleOpenChange(next);
            if (!next) onAnchorClose();
          }}
        />
      </>
    );
  return (
    <>
      <DropdownMenu open={isOpen} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={CONTENT_CLASS}>
          <ChatMenuDropdownItems model={model} />
        </DropdownMenuContent>
      </DropdownMenu>
      {anchor === null ? null : (
        <AnchoredMenu
          key={`${anchor.x}:${anchor.y}`}
          model={model}
          point={anchor}
          onClose={onAnchorClose}
        />
      )}
    </>
  );
}
