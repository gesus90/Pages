import { MessagesSquare, Search, Users } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { SURFACE_SCROLL_FADE_STYLE } from "@/app/lib/scroll-fade-style";

import { ChatPageContactDialog } from "./chat-page-contact-dialog";
import { ChatPageCreateDialog } from "./chat-page-create-dialog";
import {
  GroupEntry,
  LIST_ITEM_SELECTOR,
  ParticipantEntry,
  PlaceholderEntry,
} from "./chat-page-list-entries";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { VirtualChatDirectory } from "@/definition/VirtualChat";
import type { ChatPageState } from "./use-chat-page";

/** Focus steps of the arrow keys, Home and End in the list. */
const FOCUS_KEYS: Partial<
  Record<string, (index: number, last: number) => number>
> = {
  ArrowDown: (index, last) => Math.min(index + 1, last),
  ArrowUp: (index) => Math.max(index - 1, 0),
  Home: () => 0,
  End: (_, last) => last,
};

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
}: {
  readonly page: ChatPageState;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <label className="relative block shrink-0">
      <span className="sr-only">{t("chatPage.searchLabel")}</span>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        className="h-10 w-full rounded-xl border border-border bg-surface pr-3 pl-9 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary"
        onChange={(event) => page.setQuery(event.target.value)}
        placeholder={t("chatPage.search")}
        type="search"
        value={page.query}
      />
    </label>
  );
}

interface ChatPageListProps {
  readonly page: ChatPageState;
  readonly directory: VirtualChatDirectory;
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
 */
export function ChatPageList({
  page,
  directory,
}: ChatPageListProps): React.ReactElement {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<"group" | "contacts" | null>(null);

  function handleDialogChange(isOpen: boolean): void {
    if (!isOpen) setDialog(null);
  }

  function handleGroupCreated(groupId: string): void {
    setDialog(null);
    page.select({ kind: "group", id: groupId });
  }

  return (
    <aside
      aria-label={t("chatPage.listLabel")}
      className="hidden min-h-0 shrink-0 flex-col gap-2 rounded-2xl bg-surface p-4 shadow-card md:flex md:max-h-[36rem] lg:max-h-none lg:w-85"
      onKeyDown={moveFocus}
    >
      <SearchField page={page} />
      <GroupSection page={page} onCreate={() => setDialog("group")} />
      <hr className="mx-1 my-1 shrink-0 border-border" />
      <ParticipantSection page={page} onCreate={() => setDialog("contacts")} />
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
