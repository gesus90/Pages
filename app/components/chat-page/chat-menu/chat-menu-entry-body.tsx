import { ChevronRight } from "lucide-react";

import { cn } from "@/app/lib/cn";

import type { ChatMenuEntry } from "./chat-menu-model";

/** The row of an entry in the dropdown and in the sheet; the highlight is the light accent. */
export const CHAT_MENU_ROW_CLASS =
  "flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-3 text-left text-[13px] text-foreground outline-none data-highlighted:bg-primary-subtle data-disabled:pointer-events-none data-disabled:opacity-50 hover:bg-primary-subtle focus-visible:bg-primary-subtle disabled:pointer-events-none disabled:opacity-50";

/** The small grey heading of a section of the chat menu. */
export const CHAT_MENU_SECTION_CLASS =
  "px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase";

/** A switch in the accent color; the entry around it carries the checked state for screen readers. */
export function ChatMenuSwitch({
  isOn,
}: {
  readonly isOn: boolean;
}): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors",
        isOn ? "bg-primary" : "bg-border",
      )}
      data-switch={isOn ? "on" : "off"}
    >
      <span
        className={cn(
          "absolute size-3 rounded-full bg-surface shadow-xs transition-transform",
          isOn ? "translate-x-3.5" : "translate-x-0.5",
        )}
      />
    </span>
  );
}

/**
 * Icon, label, remark and the arrow or the switch of one entry, the same in
 * the dropdown and in the sheet of a phone.
 */
export function ChatMenuEntryBody({
  entry,
  hasArrow,
}: {
  readonly entry: ChatMenuEntry;
  /** Shows the arrow of an entry that leads on, such as a nested choice. */
  readonly hasArrow?: boolean;
}): React.ReactElement {
  const Icon = entry.icon;
  const note = entry.kind === "toggle" ? undefined : entry.note;
  const showsArrow =
    hasArrow ?? (entry.kind === "action" && entry.opensMore === true);
  return (
    <>
      <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate">{entry.label}</span>
      {note === undefined ? null : (
        <span className="shrink-0 pl-3 text-xs text-muted-foreground">
          {note}
        </span>
      )}
      {entry.kind === "toggle" ? <ChatMenuSwitch isOn={entry.isOn} /> : null}
      {showsArrow ? (
        <ChevronRight
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground"
        />
      ) : null}
    </>
  );
}
