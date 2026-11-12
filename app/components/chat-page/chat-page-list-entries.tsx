import { BellOff, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { GroupAvatars, ParticipantStatusAvatar } from "./chat-page-avatar";

import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import type {
  VirtualGroup,
  VirtualParticipant,
} from "@/definition/VirtualChat";

/**
 * What a participant shows below its name: an agent its job title, a person
 * the username.
 */
export function participantSubtitle(
  participant: Pick<VirtualParticipant, "kind" | "role" | "username">,
  t: TFunction,
): string {
  return participant.kind === "human"
    ? t("chatPage.username", { username: participant.username })
    : participant.role;
}

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

/** The unread count; a muted conversation shows it subdued behind a crossed bell (PAGE-275). */
function UnreadPill({
  count,
  isMuted = false,
}: {
  readonly count: number;
  readonly isMuted?: boolean;
}): React.ReactElement | null {
  const { t } = useTranslation();
  return (
    <>
      {isMuted ? (
        <BellOff
          aria-label={t("chatPage.muted")}
          className="size-4 shrink-0 text-muted-foreground"
          role="img"
        />
      ) : null}
      {count === 0 ? null : (
        <span
          className={cn(
            "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold",
            isMuted
              ? "bg-muted text-muted-foreground"
              : "bg-primary text-primary-foreground",
          )}
        >
          <span aria-hidden="true">{count}</span>
          <span className="sr-only">{t("chatPage.unread", { count })}</span>
        </span>
      )}
    </>
  );
}

/** Marks a conversation of agents only, which the person reads without taking part (PAGE-311). */
export function AgentConversationBadge({
  group,
}: {
  readonly group: Pick<VirtualGroup, "isAgentConversation" | "isAgentPaused">;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (group.isAgentConversation !== true && group.isAgentPaused !== true)
    return null;
  return (
    <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
      {group.isAgentPaused === true
        ? t("chatPage.agentPaused.title")
        : t("chatPage.agentConversation")}
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
      <AgentConversationBadge group={group} />
      <UnreadPill count={group.unreadCount} isMuted={group.isMuted} />
    </EntryButton>
  );
}

interface ParticipantEntryProps {
  readonly participant: VirtualParticipant;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
}

/** A participant in the list: avatar with status point, name and job title or username. */
export function ParticipantEntry({
  participant,
  isSelected,
  onSelect,
}: ParticipantEntryProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <EntryButton isSelected={isSelected} onSelect={onSelect}>
      <ParticipantStatusAvatar participant={participant} />
      <EntryText
        title={participant.name}
        subtitle={participantSubtitle(participant, t)}
      />
      <span className="sr-only">
        {t(`chatPage.status.${participant.status}`)}
      </span>
      <UnreadPill
        count={participant.unreadCount}
        isMuted={participant.isMuted}
      />
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
        "shrink-0 text-muted-foreground hover:text-primary",
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
