import { useState } from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { GroupAvatars, ParticipantStatusAvatar } from "./chat-page-avatar";

import type { ReactNode } from "react";
import type { VirtualChatSelection } from "@/definition/VirtualChat";
import type { ChatPageState } from "./use-chat-page";

/** The editable field of the input of the opened conversation. */
const COMPOSER_INPUT_SELECTOR = "[data-chat-composer] [contenteditable='true']";

/** Frames the input may take to appear after a conversation opened. */
const COMPOSER_FOCUS_ATTEMPTS = 10;

/** Above this count the badge shows "99+". */
const UNREAD_BADGE_MAXIMUM = 99;

/**
 * The text of the unread badge of the bar: the count, from 100 on "99+".
 *
 * @param count - Unread messages of the conversation.
 */
export function formatUnreadBadge(count: number): string {
  return count > UNREAD_BADGE_MAXIMUM
    ? `${UNREAD_BADGE_MAXIMUM}+`
    : String(count);
}

/** Puts the focus into the input of the conversation that just opened. */
function focusComposer(attempt = 0): void {
  window.requestAnimationFrame(() => {
    const input = document.querySelector<HTMLElement>(COMPOSER_INPUT_SELECTOR);
    if (input) {
      input.focus();
      return;
    }
    if (attempt < COMPOSER_FOCUS_ATTEMPTS) focusComposer(attempt + 1);
  });
}

/** The unread count at the top right corner of an avatar of the bar. */
function RailBadge({
  count,
  isMuted,
}: {
  readonly count: number;
  readonly isMuted: boolean;
}): React.ReactElement | null {
  if (count === 0) return null;
  return (
    <span
      aria-hidden="true"
      data-testid="chat-rail-badge"
      className={cn(
        "absolute -top-0.5 -right-0.5 inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1 text-[11px] leading-none font-semibold ring-2 ring-surface",
        isMuted
          ? "bg-muted text-muted-foreground"
          : "bg-primary text-primary-foreground",
      )}
    >
      {formatUnreadBadge(count)}
    </span>
  );
}

/** Where the tooltip of the hovered or focused entry stands on screen. */
interface RailTip {
  readonly text: string;
  readonly left: number;
  readonly top: number;
  readonly isBeside: boolean;
}

/** Right of the entry in the bar of `lg`, below it in the row of the tablet. */
function placeTip(text: string, element: HTMLElement): RailTip {
  const rect = element.getBoundingClientRect();
  const isBeside = window.matchMedia("(min-width: 1024px)").matches;
  return isBeside
    ? { text, left: rect.right + 8, top: rect.top + rect.height / 2, isBeside }
    : {
        text,
        left: rect.left + rect.width / 2,
        top: rect.bottom + 8,
        isBeside,
      };
}

interface RailEntryProps {
  readonly label: string;
  readonly count: number;
  readonly isMuted: boolean;
  readonly isSelected: boolean;
  readonly isTabStop: boolean;
  readonly onSelect: () => void;
  readonly onTip: (tip: RailTip | null) => void;
  readonly children: ReactNode;
}

/**
 * One avatar of the bar, 48 × 48 px with the avatar of 40 px; Enter opens
 * the conversation and puts the focus into its input.
 */
function RailEntry({
  label,
  count,
  isMuted,
  isSelected,
  isTabStop,
  onSelect,
  onTip,
  children,
}: RailEntryProps): React.ReactElement {
  function handleClick(event: React.MouseEvent<HTMLButtonElement>): void {
    onTip(null);
    // A click from the keyboard has no pointer and so no click count.
    if (event.detail !== 0) {
      onSelect();
      return;
    }
    flushSync(onSelect);
    focusComposer();
  }

  return (
    <button
      data-chat-list-item=""
      aria-current={isSelected ? "true" : undefined}
      aria-label={label}
      className={cn(
        "relative flex size-12 shrink-0 items-center justify-center rounded-lg transition-colors",
        isSelected ? "bg-primary-subtle" : "hover:bg-sidebar-hover",
      )}
      onBlur={() => onTip(null)}
      onClick={handleClick}
      onFocus={(event) => onTip(placeTip(label, event.currentTarget))}
      onMouseEnter={(event) => onTip(placeTip(label, event.currentTarget))}
      onMouseLeave={() => onTip(null)}
      tabIndex={isTabStop ? 0 : -1}
      type="button"
    >
      {children}
      <RailBadge count={count} isMuted={isMuted} />
    </button>
  );
}

function RailTooltip({
  tip,
}: {
  readonly tip: RailTip | null;
}): React.ReactElement | null {
  if (!tip) return null;
  return (
    <span
      aria-hidden="true"
      data-testid="chat-rail-tooltip"
      className={cn(
        "pointer-events-none fixed z-50 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-background shadow-panel",
        tip.isBeside ? "-translate-y-1/2" : "-translate-x-1/2",
      )}
      style={{ left: tip.left, top: tip.top }}
    >
      {tip.text}
    </span>
  );
}

function isSelected(
  selection: VirtualChatSelection | null,
  entry: VirtualChatSelection,
): boolean {
  return selection?.kind === entry.kind && selection.id === entry.id;
}

/** The entry that takes the one tab stop of the bar: the selection, else the first. */
function tabStopKey(page: ChatPageState): string | null {
  const keys = [
    ...page.allGroups.map((group) => `group:${group.id}`),
    ...page.allParticipants.map(
      (participant) => `participant:${participant.id}`,
    ),
  ];
  const selected = page.selection
    ? `${page.selection.kind}:${page.selection.id}`
    : null;
  return selected !== null && keys.includes(selected)
    ? selected
    : (keys[0] ?? null);
}

/**
 * The avatars of the collapsed list (PAGE-325): groups, a divider, then
 * participants, each with its unread count; only this column scrolls. The
 * bar shows every entry, whatever the search of the expanded list.
 *
 * @remarks
 * The bar is one tab stop; the arrow keys, Home and End of the list card
 * move between its entries. Below `lg` it is a row that scrolls sideways.
 */
export function ChatPageListRail({
  page,
}: {
  readonly page: ChatPageState;
}): React.ReactElement {
  const { t } = useTranslation();
  const [tip, setTip] = useState<RailTip | null>(null);
  const tabStop = tabStopKey(page);

  function entryLabel(name: string, count: number): string {
    return count === 0 ? name : t("chatPage.railUnread", { name, count });
  }

  return (
    <div
      className="-m-1 flex min-h-0 min-w-0 flex-1 flex-row items-center gap-1 overflow-x-auto overflow-y-hidden p-1 lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto"
      data-testid="chat-list-rail"
      onScroll={() => setTip(null)}
    >
      <ul
        aria-label={t("chatPage.groups")}
        className="flex shrink-0 flex-row gap-1 lg:flex-col"
      >
        {page.allGroups.map((group) => (
          <li key={group.id}>
            <RailEntry
              label={entryLabel(group.name, group.unreadCount)}
              count={group.unreadCount}
              isMuted={group.isMuted === true}
              isSelected={isSelected(page.selection, {
                kind: "group",
                id: group.id,
              })}
              isTabStop={tabStop === `group:${group.id}`}
              onSelect={() => page.select({ kind: "group", id: group.id })}
              onTip={setTip}
            >
              <GroupAvatars members={page.findMembers(group)} size="header" />
            </RailEntry>
          </li>
        ))}
      </ul>
      <hr className="m-1 h-8 w-px shrink-0 border-0 bg-border lg:h-px lg:w-8" />
      <ul
        aria-label={t("chatPage.participants")}
        className="flex shrink-0 flex-row gap-1 lg:flex-col"
      >
        {page.allParticipants.map((participant) => (
          <li key={participant.id}>
            <RailEntry
              label={entryLabel(participant.name, participant.unreadCount)}
              count={participant.unreadCount}
              isMuted={participant.isMuted === true}
              isSelected={isSelected(page.selection, {
                kind: "participant",
                id: participant.id,
              })}
              isTabStop={tabStop === `participant:${participant.id}`}
              onSelect={() =>
                page.select({ kind: "participant", id: participant.id })
              }
              onTip={setTip}
            >
              <ParticipantStatusAvatar participant={participant} />
            </RailEntry>
          </li>
        ))}
      </ul>
      <RailTooltip tip={tip} />
    </div>
  );
}
