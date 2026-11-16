import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import {
  CHAT_MENU_ROW_CLASS,
  CHAT_MENU_SECTION_CLASS,
  ChatMenuEntryBody,
} from "./chat-menu-entry-body";

import type {
  ChatMenuAction,
  ChatMenuEntry,
  ChatMenuModel,
} from "./chat-menu-model";

const ITEM_SELECTOR = "[data-chat-menu-entry]:not([disabled])";

/** Moves the focus between the entries of the sheet with the arrow keys, Home and End. */
function moveFocus(event: React.KeyboardEvent<HTMLElement>): void {
  const steps: Partial<
    Record<string, (index: number, last: number) => number>
  > = {
    ArrowDown: (index, last) => (index >= last ? 0 : index + 1),
    ArrowUp: (index, last) => (index <= 0 ? last : index - 1),
    Home: () => 0,
    End: (_, last) => last,
  };
  const step = steps[event.key];
  if (step === undefined) return;
  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(ITEM_SELECTOR),
  );
  if (items.length === 0) return;
  event.preventDefault();
  const index = items.findIndex((item) => item === document.activeElement);
  items[step(index, items.length - 1)]?.focus();
}

interface SheetEntryProps {
  readonly entry: ChatMenuEntry;
  /** Closes the sheet before an action runs; a switch leaves it open. */
  readonly onClose: () => void;
  readonly isNested?: boolean;
}

function SheetAction({
  entry,
  onClose,
  isNested = false,
}: SheetEntryProps & { readonly entry: ChatMenuAction }): React.ReactElement {
  function handleClick(): void {
    onClose();
    entry.onSelect();
  }

  return (
    <button
      className={cn(
        CHAT_MENU_ROW_CLASS,
        "min-h-11",
        isNested && "pl-9",
        entry.isDestructive === true && "text-destructive",
      )}
      data-chat-menu-entry={entry.id}
      disabled={entry.isDisabled}
      onClick={handleClick}
      role="menuitem"
      type="button"
    >
      <ChatMenuEntryBody entry={entry} />
    </button>
  );
}

/** One entry as a button of the sheet; a nested choice shows its entries right below it. */
function SheetEntry({ entry, onClose }: SheetEntryProps): React.ReactElement {
  if (entry.kind === "toggle")
    return (
      <button
        aria-checked={entry.isOn}
        className={cn(CHAT_MENU_ROW_CLASS, "min-h-11")}
        data-chat-menu-entry={entry.id}
        onClick={entry.onToggle}
        role="menuitemcheckbox"
        type="button"
      >
        <ChatMenuEntryBody entry={entry} />
      </button>
    );
  if (entry.kind === "submenu")
    return (
      <div aria-label={entry.label} role="group">
        <div className="flex min-h-9 items-center gap-2.5 px-3 text-[13px] text-muted-foreground">
          <ChatMenuEntryBody entry={entry} hasArrow={false} />
        </div>
        {entry.entries.map((child) => (
          <SheetAction
            key={child.id}
            entry={child}
            onClose={onClose}
            isNested
          />
        ))}
      </div>
    );
  return <SheetAction entry={entry} onClose={onClose} />;
}

/**
 * The chat menu as a sheet from the bottom on a phone, with the
 * same head, sections and entries as the dropdown. Esc and a tap beside it
 * close it; the arrow keys move between the entries.
 */
export function ChatMenuSheet({
  model,
  isOpen,
  onOpenChange,
}: {
  readonly model: ChatMenuModel;
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const close = (): void => onOpenChange(false);
  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-scrim-drawer" />
        <DialogPrimitive.Content
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col overflow-y-auto rounded-t-2xl bg-surface p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-panel outline-none"
          data-chat-menu-sheet=""
        >
          <span
            aria-hidden="true"
            className="mx-auto mt-1 mb-2 h-1 w-10 shrink-0 rounded-full bg-border"
          />
          <div className="flex min-w-0 flex-col px-3 pb-1.5">
            <DialogPrimitive.Title className="truncate text-sm font-semibold text-foreground">
              {model.title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="truncate text-xs text-muted-foreground">
              {model.subtitle}
            </DialogPrimitive.Description>
          </div>
          <div
            aria-label={t("chatPage.chatMenu.label")}
            onKeyDown={moveFocus}
            role="menu"
          >
            {model.sections.map((section) => (
              <div
                aria-label={section.title}
                className="border-t border-border pt-1 mt-1"
                key={section.id}
                role="group"
              >
                {section.title === undefined ? null : (
                  <p className={CHAT_MENU_SECTION_CLASS}>{section.title}</p>
                )}
                {section.entries.map((entry) => (
                  <SheetEntry key={entry.id} entry={entry} onClose={close} />
                ))}
              </div>
            ))}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
