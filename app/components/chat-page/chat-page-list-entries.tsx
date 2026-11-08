import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { GroupAvatars, ParticipantStatusAvatar } from "./chat-page-avatar";

import type { ReactNode } from "react";
import type {
  VirtualGroup,
  VirtualParticipant,
} from "@/definition/VirtualChat";

/** Selects the controls the arrow keys move between. */
export const LIST_ITEM_SELECTOR = "[data-chat-list-item]";

const ENTRY_CLASS_NAME =
  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors";

interface EntryButtonProps {
  readonly isSelected: boolean;
  readonly onSelect: () => void;
  readonly children: ReactNode;
}

function EntryButton({
  isSelected,
  onSelect,
  children,
}: EntryButtonProps): React.ReactElement {
  return (
    <button
      data-chat-list-item=""
      aria-current={isSelected ? "true" : undefined}
      className={cn(
        ENTRY_CLASS_NAME,
        isSelected ? "bg-primary-subtle" : "hover:bg-sidebar-hover",
      )}
      onClick={onSelect}
      type="button"
    >
      {children}
    </button>
  );
}

function EntryText({
  title,
  subtitle,
}: {
  readonly title: string;
  readonly subtitle: string;
}): React.ReactElement {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate text-[15px] font-semibold text-foreground">
        {title}
      </span>
      <span className="truncate text-[13px] text-muted-foreground">
        {subtitle}
      </span>
    </span>
  );
}

function UnreadPill({
  count,
}: {
  readonly count: number;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (count === 0) return null;
  return (
    <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
      <span aria-hidden="true">{count}</span>
      <span className="sr-only">{t("chatPage.unread", { count })}</span>
    </span>
  );
}

interface GroupEntryProps {
  readonly group: VirtualGroup;
  readonly members: readonly VirtualParticipant[];
  readonly isSelected: boolean;
  readonly onSelect: () => void;
}

/** A group in the list: overlapping member avatars, name and member names. */
export function GroupEntry({
  group,
  members,
  isSelected,
  onSelect,
}: GroupEntryProps): React.ReactElement {
  return (
    <EntryButton isSelected={isSelected} onSelect={onSelect}>
      <span className="flex size-10 shrink-0 items-center justify-center">
        <GroupAvatars members={members} size="list" />
      </span>
      <EntryText
        title={group.name}
        subtitle={members.map((member) => member.name).join(", ")}
      />
      <UnreadPill count={group.unreadCount} />
    </EntryButton>
  );
}

interface ParticipantEntryProps {
  readonly participant: VirtualParticipant;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
}

/** A participant in the list: avatar with status point, name and role. */
export function ParticipantEntry({
  participant,
  isSelected,
  onSelect,
}: ParticipantEntryProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <EntryButton isSelected={isSelected} onSelect={onSelect}>
      <ParticipantStatusAvatar participant={participant} />
      <EntryText title={participant.name} subtitle={participant.role} />
      <span className="sr-only">
        {t(`chatPage.status.${participant.status}`)}
      </span>
      <UnreadPill count={participant.unreadCount} />
    </EntryButton>
  );
}

interface PlaceholderEntryProps {
  readonly title: string;
  readonly hint: string;
  readonly shape: "square" | "round";
  readonly onOpen: () => void;
}

/**
 * The dashed last entry of a section that opens the create dialog.
 *
 * @remarks
 * Text and dashed frame share the current color, so hover turns both primary.
 */
export function PlaceholderEntry({
  title,
  hint,
  shape,
  onOpen,
}: PlaceholderEntryProps): React.ReactElement {
  return (
    <button
      data-chat-list-item=""
      aria-haspopup="dialog"
      className={cn(
        ENTRY_CLASS_NAME,
        "text-muted-foreground hover:text-primary",
      )}
      onClick={onOpen}
      type="button"
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-10 shrink-0 items-center justify-center border-[1.5px] border-dashed border-current",
          shape === "square" ? "rounded-lg" : "rounded-full",
        )}
      >
        <Plus className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-medium">{title}</span>
        <span className="truncate text-[13px]">{hint}</span>
      </span>
    </button>
  );
}
