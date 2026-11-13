import { DropdownMenuItem } from "@/app/components/ui/dropdown-menu";

import type { LucideIcon } from "lucide-react";

/** The small capital heading of a section of a menu of the chat head. */
export const MENU_SECTION_LABEL =
  "text-[11px] font-semibold tracking-wide text-muted-foreground uppercase";

interface ChatPageMenuEntryProps {
  readonly icon: LucideIcon;
  readonly label: string;
  /** A short remark at the right edge. */
  readonly note?: string;
  readonly isDisabled?: boolean;
  readonly onSelect: () => void;
}

/** One entry of a menu in the head of the chat: icon, label and an optional remark. */
export function ChatPageMenuEntry({
  icon: Icon,
  label,
  note,
  isDisabled = false,
  onSelect,
}: ChatPageMenuEntryProps): React.ReactElement {
  return (
    <DropdownMenuItem
      className="min-h-9 gap-2.5 text-[13px]"
      disabled={isDisabled}
      onSelect={onSelect}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="flex-1">{label}</span>
      {note === undefined ? null : (
        <span className="pl-3 text-xs text-muted-foreground">{note}</span>
      )}
    </DropdownMenuItem>
  );
}
