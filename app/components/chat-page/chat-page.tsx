import { useTranslation } from "react-i18next";

import { ChatPageComposer } from "./chat-page-composer";
import { ChatPageHeader } from "./chat-page-header";
import { ChatPageHistory } from "./chat-page-history";
import { ChatPageList } from "./chat-page-list";
import { ChatPagePicker } from "./chat-page-picker";
import { useChatPage } from "./use-chat-page";

import type { VirtualChatDirectory } from "@/definition/VirtualChat";
import type { ChatPageState, OpenedConversation } from "./use-chat-page";

function conversationName(opened: OpenedConversation): string {
  return opened.kind === "group" ? opened.group.name : opened.participant.name;
}

function conversationKey(opened: OpenedConversation): string {
  return opened.kind === "group"
    ? `group:${opened.group.id}`
    : `participant:${opened.participant.id}`;
}

/** The opened conversation directly on the page background, without card. */
function ChatPageConversation({
  page,
}: {
  readonly page: ChatPageState;
}): React.ReactElement {
  const { t } = useTranslation();
  const { opened } = page;
  if (!opened)
    return (
      <p className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {t("chatPage.nothingSelected")}
      </p>
    );
  const name = conversationName(opened);
  const isGroup = opened.kind === "group";
  return (
    <section
      aria-label={name}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-4"
    >
      <ChatPageHeader opened={opened} />
      <ChatPageHistory
        messages={page.messages}
        name={name}
        isGroup={isGroup}
        findParticipant={page.findParticipant}
      />
      <ChatPageComposer
        key={conversationKey(opened)}
        label={t("chatPage.inputLabel", { name })}
        placeholder={
          isGroup
            ? t("chatPage.groupPlaceholder", { name })
            : t("chatPage.participantPlaceholder", { name })
        }
        onSend={page.send}
      />
    </section>
  );
}

/**
 * The chat page with virtual participants and groups (PAGE-254).
 *
 * @remarks
 * Two columns 32 px apart down to the foot of the page: the list card of 340
 * px with its own scroll area, and the chat without card or background.
 * Below `lg` the list stands above the chat; below `md` a selection replaces
 * it. The page only shows the interface: without stored data the directory
 * is empty, and sent messages stay local.
 */
export function ChatPage({
  directory,
}: {
  readonly directory: VirtualChatDirectory;
}): React.ReactElement {
  const { t } = useTranslation();
  const page = useChatPage(directory);
  return (
    <section className="pages-page-fill flex w-full flex-col">
      <header className="shrink-0">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("chatPage.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("chatPage.subtitle")}
        </p>
      </header>
      <div className="mt-6 flex min-h-0 flex-1 flex-col gap-4 md:gap-8 lg:flex-row">
        <ChatPageList page={page} directory={directory} />
        <ChatPagePicker page={page} />
        <ChatPageConversation page={page} />
      </div>
    </section>
  );
}
