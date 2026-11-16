import { DropdownMenuItem } from "@/app/components/ui/dropdown-menu";
import { cn } from "@/app/lib/cn";

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
  /** Shows an entry that removes or deletes in the destructive color. */
  readonly isDestructive?: boolean;
  readonly onSelect: () => void;
}

/** One entry of a menu in the head of the chat: icon, label and an optional remark. */
export function ChatPageMenuEntry({
  icon: Icon,
  label,
  note,
  isDisabled = false,
  isDestructive = false,
  onSelect,
}: ChatPageMenuEntryProps): React.ReactElement {
  return (
    <DropdownMenuItem
      className={cn(
        "min-h-9 gap-2.5 text-[13px]",
        isDestructive && "text-destructive",
      )}
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
