import { MessagesSquare, Search, Users } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ScrollViewport } from "@/app/components/ui/scroll-viewport";

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

interface ListSectionProps {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly count: number;
  readonly isEmpty: boolean;
  readonly children: ReactNode;
}

function ListSection({
  icon: Icon,
  title,
  count,
  isEmpty,
  children,
}: ListSectionProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <header className="flex items-center gap-3 px-1 py-2">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-subtle text-primary">
          <Icon aria-hidden="true" className="size-5" />
        </span>
        <h2 className="flex-1 text-lg font-semibold text-foreground">
          {title}
        </h2>
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground">
          {count}
        </span>
      </header>
      {isEmpty ? (
        <p className="px-3 py-2 text-[13px] text-muted-foreground">
          {t("chatPage.noMatches")}
        </p>
      ) : null}
      <ul className="flex flex-col gap-1">{children}</ul>
    </section>
  );
}

function moveFocus(event: React.KeyboardEvent<HTMLElement>): void {
  const step = FOCUS_KEYS[event.key];
  if (!step) return;
  const items = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(LIST_ITEM_SELECTOR),
  ];
  const index = items.findIndex((item) => item === document.activeElement);
  if (index < 0) return;
  event.preventDefault();
  items[step(index, items.length - 1)]?.focus();
}

interface SectionProps {
  readonly page: ChatPageState;
  readonly onCreate: () => void;
}

function GroupSection({ page, onCreate }: SectionProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <ListSection
      icon={MessagesSquare}
      title={t("chatPage.groups")}
      count={page.groups.length}
      isEmpty={page.query.trim() !== "" && page.groups.length === 0}
    >
      {page.groups.map((group) => (
        <li key={group.id}>
          <GroupEntry
            group={group}
            members={page.findMembers(group)}
            isSelected={
              page.selection?.kind === "group" && page.selection.id === group.id
            }
            onSelect={() => page.select({ kind: "group", id: group.id })}
          />
        </li>
      ))}
      <li>
        <PlaceholderEntry
          title={t("chatPage.newGroup")}
          hint={t("chatPage.newGroupHint")}
          shape="square"
          onOpen={onCreate}
        />
      </li>
    </ListSection>
  );
}

function ParticipantSection({
  page,
  onCreate,
}: SectionProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <ListSection
      icon={Users}
      title={t("chatPage.participants")}
      count={page.participants.length}
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
      <li>
        <PlaceholderEntry
          title={t("chatPage.newParticipant")}
          hint={t("chatPage.newParticipantHint")}
          shape="round"
          onOpen={onCreate}
        />
      </li>
    </ListSection>
  );
}

function SearchField({
  page,
}: {
  readonly page: ChatPageState;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <label className="relative block">
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
 * The list card of the chat page: search, groups and participants, each
 * section ending with its dashed placeholder.
 *
 * @remarks
 * Entries are buttons with `aria-current` for the selection; the arrow keys,
 * Home and End move between them, Enter opens one.
 */
export function ChatPageList({
  page,
  directory,
}: ChatPageListProps): React.ReactElement {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<"group" | "participant" | null>(null);

  function handleDialogChange(isOpen: boolean): void {
    if (!isOpen) setDialog(null);
  }

  return (
    <ScrollViewport
      as="aside"
      aria-label={t("chatPage.listLabel")}
      containerClassName="hidden min-h-0 shrink-0 rounded-2xl bg-surface shadow-card md:grid md:max-h-80 lg:max-h-none lg:w-85 [--scroll-fade-color:var(--color-surface)]"
      className="flex flex-col gap-2 p-4"
      onKeyDown={moveFocus}
    >
      <SearchField page={page} />
      <GroupSection page={page} onCreate={() => setDialog("group")} />
      <hr className="mx-1 my-2 border-border" />
      <ParticipantSection
        page={page}
        onCreate={() => setDialog("participant")}
      />
      <ChatPageCreateDialog
        kind={dialog}
        directory={directory}
        onOpenChange={handleDialogChange}
      />
    </ScrollViewport>
  );
}
