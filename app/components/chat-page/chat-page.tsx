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

/** The input at the foot, or why nothing can be sent to the opened participant. */
function ConversationFoot({
  page,
  opened,
}: {
  readonly page: ChatPageState;
  readonly opened: OpenedConversation;
}): React.ReactElement {
  const { t } = useTranslation();
  const name = conversationName(opened);
  const isGroup = opened.kind === "group";
  if (opened.kind === "participant" && !opened.participant.canChat)
    return (
      <p className="mr-22 shrink-0 rounded-[14px] bg-surface p-4 text-sm text-muted-foreground shadow-card">
        {opened.participant.kind === "agent"
          ? t("chatPage.agentInactive", { name })
          : t("chatPage.personNotYet", { name })}
      </p>
    );
  return (
    <div className="flex shrink-0 flex-col gap-2">
      {page.sendFailure ? (
        <p className="mr-22 text-sm text-destructive" role="alert">
          {t(`chatPage.sendFailure.${page.sendFailure}`, { name })}
        </p>
      ) : null}
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
    </div>
  );
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
  return (
    <section
      aria-label={name}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-4"
    >
      <ChatPageHeader
        opened={opened}
        participants={page.allParticipants}
        isAnswering={page.isAnswering}
        onStop={page.stop}
        onAddMember={page.addMember}
      />
      <ChatPageHistory
        messages={page.messages}
        name={name}
        findParticipant={page.findParticipant}
        isAnswering={page.isAnswering}
      />
      <ConversationFoot page={page} opened={opened} />
    </section>
  );
}

/**
 * The chat page with people, agents and groups (PAGE-254, PAGE-266,
 * PAGE-259).
 *
 * @remarks
 * Two columns 32 px apart down to the foot of the page: the list card of 340
 * px with a scroll area for each list, and the chat without card or
 * background.
 * Below `lg` the list stands above the chat; below `md` a selection replaces
 * it. Messages go to active agents, which answer over ACP; a message to a
 * group stays in this visit. The list holds only existing people and agents
 * the person chose, and groups of them.
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
