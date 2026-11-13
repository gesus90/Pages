import {
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Users,
} from "lucide-react";
import { useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { cn } from "@/app/lib/cn";
import { SURFACE_SCROLL_FADE_STYLE } from "@/app/lib/scroll-fade-style";

import { ChatPageContactDialog } from "./chat-page-contact-dialog";
import { ChatPageCreateDialog } from "./chat-page-create-dialog";
import {
  GroupEntry,
  LIST_ITEM_SELECTOR,
  ParticipantEntry,
  PlaceholderEntry,
} from "./chat-page-list-entries";
import { ChatPageListRail } from "./chat-page-list-rail";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { VirtualChatDirectory } from "@/definition/VirtualChat";
import type { ChatPageState } from "./use-chat-page";
import type { ChatListCollapse } from "./use-chat-list-collapse";

/** Focus steps of the arrow keys, Home and End in the list; left and right serve the row of the bar. */
const FOCUS_KEYS: Partial<
  Record<string, (index: number, last: number) => number>
> = {
  ArrowDown: (index, last) => Math.min(index + 1, last),
  ArrowUp: (index) => Math.max(index - 1, 0),
  ArrowRight: (index, last) => Math.min(index + 1, last),
  ArrowLeft: (index) => Math.max(index - 1, 0),
  Home: () => 0,
  End: (_, last) => last,
};

/** The card in both states; the width changes in 200 ms unless motion is reduced. */
const CARD_CLASS_NAME =
  "hidden min-h-0 shrink-0 gap-2 rounded-2xl bg-surface shadow-card md:flex motion-safe:lg:transition-[width] motion-safe:lg:duration-200 motion-safe:lg:ease-out";

/** Expanded: 340 px beside the chat, at most 36 rem above it below `lg`. */
const EXPANDED_CARD_CLASS_NAME =
  "flex-col p-4 md:max-h-[36rem] lg:max-h-none lg:w-85";

/** Collapsed: a row of 72 px above the chat below `lg`, a bar of 72 px beside it. */
const COLLAPSED_CARD_CLASS_NAME =
  "flex-row items-center p-3 md:h-18 lg:h-auto lg:w-18 lg:flex-col lg:items-stretch";

/** Each list grows evenly but never beyond its entries; below `lg` it keeps 64 px. */
const LIST_AREA_CLASS_NAME = "min-h-16 flex-[1_1_0px] max-h-max lg:min-h-0";

function SectionHead({
  icon: Icon,
  title,
  count,
}: {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly count: number;
}): React.ReactElement {
  return (
    <header className="flex shrink-0 items-center gap-3 px-1 py-2">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-subtle text-primary">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <h2 className="flex-1 text-lg font-semibold text-foreground">{title}</h2>
      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground">
        {count}
      </span>
    </header>
  );
}

interface ListAreaProps {
  readonly label: string;
  readonly isEmpty: boolean;
  readonly children: ReactNode;
}

/** The own scroll area of one list, fading into the card at its edges. */
function ListArea({
  label,
  isEmpty,
  children,
}: ListAreaProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <ScrollViewport
      aria-label={label}
      className="flex flex-col gap-1"
      containerClassName={LIST_AREA_CLASS_NAME}
      containerStyle={SURFACE_SCROLL_FADE_STYLE}
    >
      {isEmpty ? (
        <p className="px-3 py-2 text-[13px] text-muted-foreground">
          {t("chatPage.noMatches")}
        </p>
      ) : null}
      <ul className="flex flex-col gap-1">{children}</ul>
    </ScrollViewport>
  );
}

/** Moves the focus between the entries of both lists and keeps it in view. */
function moveFocus(event: React.KeyboardEvent<HTMLElement>): void {
  const step = FOCUS_KEYS[event.key];
  if (!step) return;
  const items = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(LIST_ITEM_SELECTOR),
  ];
  const index = items.findIndex((item) => item === document.activeElement);
  if (index < 0) return;
  event.preventDefault();
  const target = items[step(index, items.length - 1)];
  target?.focus({ preventScroll: true });
  target?.scrollIntoView({ block: "nearest" });
}

interface SectionProps {
  readonly page: ChatPageState;
  readonly onCreate: () => void;
}

/** Head, scrolling groups and the fixed entry "Neue Gruppe". */
function GroupSection({ page, onCreate }: SectionProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <>
      <SectionHead
        icon={MessagesSquare}
        title={t("chatPage.groups")}
        count={page.groups.length}
      />
      <ListArea
        label={t("chatPage.groups")}
        isEmpty={page.query.trim() !== "" && page.groups.length === 0}
      >
        {page.groups.map((group) => (
          <li key={group.id}>
            <GroupEntry
              group={group}
              members={page.findMembers(group)}
              isSelected={
                page.selection?.kind === "group" &&
                page.selection.id === group.id
              }
              onSelect={() => page.select({ kind: "group", id: group.id })}
            />
          </li>
        ))}
      </ListArea>
      <PlaceholderEntry
        title={t("chatPage.newGroup")}
        hint={t("chatPage.newGroupHint")}
        shape="square"
        onOpen={onCreate}
      />
    </>
  );
}

/** Head, scrolling participants and the fixed entry "Teilnehmer hinzufügen". */
function ParticipantSection({
  page,
  onCreate,
}: SectionProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <>
      <SectionHead
        icon={Users}
        title={t("chatPage.participants")}
        count={page.participants.length}
      />
      <ListArea
        label={t("chatPage.participants")}
        isEmpty={page.query.trim() !== "" && page.participants.length === 0}
      >
        {page.participants.map((participant) => (
          <li key={participant.id}>
            <ParticipantEntry
              participant={participant}
              isSelected={
                page.selection?.kind === "participant" &&
                page.selection.id === participant.id
              }
              onSelect={() =>
                page.select({ kind: "participant", id: participant.id })
              }
            />
          </li>
        ))}
      </ListArea>
      <PlaceholderEntry
        title={t("chatPage.addParticipant")}
        hint={t("chatPage.addParticipantHint")}
        shape="round"
        onOpen={onCreate}
      />
    </>
  );
}

function SearchField({
  page,
  inputRef,
}: {
  readonly page: ChatPageState;
  readonly inputRef: React.RefObject<HTMLInputElement | null>;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <label className="relative block min-w-0 flex-1">
      <span className="sr-only">{t("chatPage.searchLabel")}</span>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        className="h-10 w-full rounded-xl border border-border bg-surface pr-3 pl-9 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary"
        onChange={(event) => page.setQuery(event.target.value)}
        placeholder={t("chatPage.search")}
        ref={inputRef}
        type="search"
        value={page.query}
      />
    </label>
  );
}

interface ListToggleProps {
  readonly collapse: ChatListCollapse;
  readonly controlsId: string;
}

/** The ghost button that collapses and expands the list (PAGE-325). */
function ListToggle({
  collapse,
  controlsId,
}: ListToggleProps): React.ReactElement {
  const { t } = useTranslation();
  const label = t(
    collapse.isCollapsed ? "chatPage.expandList" : "chatPage.collapseList",
  );
  const Icon = collapse.isCollapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <Button
      aria-controls={controlsId}
      aria-expanded={!collapse.isCollapsed}
      aria-label={label}
      aria-keyshortcuts="Control+Shift+L Meta+Shift+L"
      className="size-10 shrink-0 text-muted-foreground hover:text-foreground xl:size-10"
      onClick={collapse.toggle}
      size="icon"
      title={label}
      variant="ghost"
    >
      <Icon aria-hidden="true" className="size-4.5" />
    </Button>
  );
}

/** The magnifier of the bar: it expands the list and puts the focus into the search. */
function SearchButton({
  onSearch,
}: {
  readonly onSearch: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <Button
      aria-label={t("chatPage.searchLabel")}
      className="size-10 shrink-0 text-muted-foreground hover:text-foreground xl:size-10"
      onClick={onSearch}
      size="icon"
      title={t("chatPage.searchLabel")}
      variant="ghost"
    >
      <Search aria-hidden="true" className="size-4.5" />
    </Button>
  );
}

interface ExpandedListProps {
  readonly page: ChatPageState;
  readonly onCreate: (dialog: "group" | "contacts") => void;
}

/** Groups and participants with their names, as the expanded card shows them. */
function ExpandedList({
  page,
  onCreate,
}: ExpandedListProps): React.ReactElement {
  return (
    <>
      <GroupSection page={page} onCreate={() => onCreate("group")} />
      <hr className="mx-1 my-1 shrink-0 border-border" />
      <ParticipantSection page={page} onCreate={() => onCreate("contacts")} />
    </>
  );
}

interface ChatPageListProps {
  readonly page: ChatPageState;
  readonly directory: VirtualChatDirectory;
  readonly collapse: ChatListCollapse;
}

/**
 * The list card of the chat page (PAGE-259): the search, then the groups
 * and the participants, each between its fixed head and its fixed dashed
 * entry; "Teilnehmer hinzufügen" closes the card at the bottom.
 *
 * @remarks
 * The card itself does not scroll; each list has its own scroll area, and
 * both share the free height evenly, a short list leaving its rest to the
 * other. Entries are buttons with `aria-current` for the selection; the
 * arrow keys, Home and End move across both lists, Enter opens one.
 * The toggle beside the search collapses the card to a bar of avatars of
 * 72 px (PAGE-325); the toggle keeps its place in the tree, so the focus
 * stays on it.
 */
export function ChatPageList({
  page,
  directory,
  collapse,
}: ChatPageListProps): React.ReactElement {
  const { t } = useTranslation();
  const listId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<"group" | "contacts" | null>(null);
  const { isCollapsed } = collapse;

  function handleDialogChange(isOpen: boolean): void {
    if (!isOpen) setDialog(null);
  }

  function handleGroupCreated(groupId: string): void {
    setDialog(null);
    page.select({ kind: "group", id: groupId });
  }

  function handleSearch(): void {
    flushSync(collapse.expand);
    searchRef.current?.focus();
  }

  return (
    <aside
      aria-label={t("chatPage.listLabel")}
      className={cn(
        CARD_CLASS_NAME,
        isCollapsed ? COLLAPSED_CARD_CLASS_NAME : EXPANDED_CARD_CLASS_NAME,
      )}
      data-collapsed={isCollapsed ? "true" : "false"}
      id={listId}
      onKeyDown={moveFocus}
    >
      <div
        className={cn(
          "flex shrink-0 items-center gap-2",
          isCollapsed && "flex-row lg:flex-col",
        )}
      >
        {isCollapsed ? null : <SearchField page={page} inputRef={searchRef} />}
        <ListToggle collapse={collapse} controlsId={listId} />
        {isCollapsed ? <SearchButton onSearch={handleSearch} /> : null}
      </div>
      {isCollapsed ? (
        <ChatPageListRail page={page} />
      ) : (
        <ExpandedList page={page} onCreate={setDialog} />
      )}
      <ChatPageCreateDialog
        isOpen={dialog === "group"}
        participants={page.allParticipants}
        onOpenChange={handleDialogChange}
        onCreated={handleGroupCreated}
      />
      <ChatPageContactDialog
        isOpen={dialog === "contacts"}
        onOpenChange={handleDialogChange}
        choices={directory.contactChoices}
        selectedIds={page.allParticipants.map((participant) => participant.id)}
      />
    </aside>
  );
}
