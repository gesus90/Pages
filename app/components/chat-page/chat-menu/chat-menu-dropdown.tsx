import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";

import {
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
} from "@/app/components/ui/dropdown-menu";
import { cn } from "@/app/lib/cn";

import {
  CHAT_MENU_ROW_CLASS,
  CHAT_MENU_SECTION_CLASS,
  ChatMenuEntryBody,
} from "./chat-menu-entry-body";

import type {
  ChatMenuEntry,
  ChatMenuModel,
  ChatMenuSection,
} from "./chat-menu-model";

/** Name and subtitle of the chat at the top of the menu, such as "Gruppe · 7 Mitglieder". */
export function ChatMenuHead({
  model,
}: {
  readonly model: ChatMenuModel;
}): React.ReactElement {
  return (
    <div className="flex min-w-0 flex-col px-3 pt-2 pb-1.5">
      <span className="truncate text-sm font-semibold text-foreground">
        {model.title}
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {model.subtitle}
      </span>
    </div>
  );
}

/** One entry as an item of the dropdown; a switch keeps the menu open. */
function DropdownEntry({
  entry,
}: {
  readonly entry: ChatMenuEntry;
}): React.ReactElement {
  if (entry.kind === "toggle")
    return (
      <DropdownMenuPrimitive.CheckboxItem
        checked={entry.isOn}
        className={CHAT_MENU_ROW_CLASS}
        data-chat-menu-entry={entry.id}
        onSelect={(event) => {
          event.preventDefault();
          entry.onToggle();
        }}
      >
        <ChatMenuEntryBody entry={entry} />
      </DropdownMenuPrimitive.CheckboxItem>
    );
  if (entry.kind === "submenu")
    return (
      <DropdownMenuSub>
        <DropdownMenuPrimitive.SubTrigger
          className={cn(
            CHAT_MENU_ROW_CLASS,
            "data-[state=open]:bg-primary-subtle",
          )}
          data-chat-menu-entry={entry.id}
        >
          <ChatMenuEntryBody entry={entry} hasArrow />
        </DropdownMenuPrimitive.SubTrigger>
        <DropdownMenuSubContent className="w-64">
          {entry.entries.map((child) => (
            <DropdownEntry key={child.id} entry={child} />
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        CHAT_MENU_ROW_CLASS,
        entry.isDestructive && "text-destructive",
      )}
      data-chat-menu-entry={entry.id}
      disabled={entry.isDisabled}
      onSelect={entry.onSelect}
    >
      <ChatMenuEntryBody entry={entry} />
    </DropdownMenuPrimitive.Item>
  );
}

function DropdownSection({
  section,
}: {
  readonly section: ChatMenuSection;
}): React.ReactElement {
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuPrimitive.Group aria-label={section.title}>
        {section.title === undefined ? null : (
          <DropdownMenuLabel className={CHAT_MENU_SECTION_CLASS}>
            {section.title}
          </DropdownMenuLabel>
        )}
        {section.entries.map((entry) => (
          <DropdownEntry key={entry.id} entry={entry} />
        ))}
      </DropdownMenuPrimitive.Group>
    </>
  );
}

/**
 * The content of the chat menu inside a dropdown (PAGE-389): the head, then
 * each section with its small grey heading. Radix moves the focus with the
 * arrow keys, runs an entry with Enter, closes with Esc and with a click
 * beside it.
 */
export function ChatMenuDropdownItems({
  model,
}: {
  readonly model: ChatMenuModel;
}): React.ReactElement {
  return (
    <>
      <ChatMenuHead model={model} />
      {model.sections.map((section) => (
        <DropdownSection key={section.id} section={section} />
      ))}
    </>
  );
}
