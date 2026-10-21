import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { WikiMarkdown } from "@/app/components/wiki/wiki-markdown";
import { cn } from "@/app/lib/cn";

import { ChatAttachmentList } from "./chat-attachment-list";
import { chatErrorText } from "./chat-error";
import { ChatJobStatus } from "./chat-job-status";
import { ChatLiveStatus } from "./chat-live-status";
import { ChatMessageMeta, chatMessageFacts } from "./chat-message-meta";
import { ChatQuotaDemoAnswer } from "./chat-quota-demo";
import { PicaMascot } from "./pica-mascot";
import { shownQuotaDemoHold } from "./use-chat-quota-demo";

import type { ChatMessage } from "@/definition/Chat";
import type { ChatJobState } from "@/definition/ChatJob";
import type { ChatController } from "./use-chat";
import type { ChatMessageFacts } from "./chat-message-meta";
import type { ChatQuotaDemoHold } from "./use-chat-quota-demo";

interface ChatMessageListProps {
  readonly chat: ChatController;
  readonly isOpen: boolean;
}

function hideImages(): boolean {
  return false;
}

/** One message; answers and own messages both render Markdown and code blocks (T6.12.10). */
function ChatMessageItem({
  message,
  facts,
}: {
  readonly message: Pick<
    ChatMessage,
    "role" | "content" | "attachments" | "isStopped"
  > &
    Partial<Pick<ChatMessage, "id">>;
  readonly facts?: ChatMessageFacts;
}): React.ReactElement {
  const { t } = useTranslation();
  const isOwn = message.role === "user";
  return (
    <article
      aria-label={isOwn ? t("chat.you") : t("chat.title")}
      className={cn("flex gap-2", isOwn ? "justify-end" : "justify-start")}
    >
      {isOwn ? null : <PicaMascot className="mt-1 size-7" />}
      <div
        className={cn(
          "min-w-0 max-w-[85%] rounded-2xl px-3 py-2",
          isOwn ? "bg-muted" : "bg-surface ring-1 ring-border",
        )}
      >
        {message.content ? (
          <WikiMarkdown
            isDisplayableImage={hideImages}
            source={message.content}
          />
        ) : null}
        <ChatAttachmentList attachments={message.attachments} />
        {message.isStopped === true ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("chat.stoppedAnswer")}
          </p>
        ) : null}
        {isOwn && message.id && facts ? (
          <ChatMessageMeta
            steer={facts.steers[message.id]}
            selection={facts.selections[message.id]}
          />
        ) : null}
      </div>
    </article>
  );
}

/** What the list shows besides the stored messages, and how many rows that makes. */
function listContent(chat: ChatController): {
  readonly sending: ChatController["sending"];
  readonly live: ChatController["jobs"]["live"];
  readonly jobState: ChatJobState | undefined;
  readonly facts: ChatMessageFacts;
  readonly quotaHold: ChatQuotaDemoHold | null;
  readonly count: number;
} {
  const { messages, session, activity } = chat.view;
  // A message is only shown in the session it was sent to.
  const sending =
    chat.sending !== null && chat.sending.sessionId === session?.id
      ? chat.sending
      : null;
  const { live } = chat.jobs;
  const quotaHold = shownQuotaDemoHold(chat.quotaDemo, session?.id);
  return {
    sending,
    live,
    jobState: live?.ended?.state ?? live?.job.state,
    facts: chatMessageFacts(activity, live?.steers),
    quotaHold,
    count:
      messages.length +
      (sending ? 1 : 0) +
      (live ? 1 : 0) +
      (quotaHold ? 1 : 0),
  };
}

/** The conversation of the open session, newest at the bottom. */
export function ChatMessageList({
  chat,
  isOpen,
}: ChatMessageListProps): React.ReactElement {
  const { t } = useTranslation();
  const end = useRef<HTMLDivElement>(null);
  const { messages } = chat.view;
  const { sending, live, jobState, facts, quotaHold, count } =
    listContent(chat);
  const heldAt = quotaHold?.heldAt;

  useEffect(() => {
    // A hidden panel cannot scroll, so reopening it shows what arrived meanwhile.
    // A terminal status expands the row; hidden intermediate text never moves the list.
    if (isOpen) end.current?.scrollIntoView({ block: "end" });
  }, [count, chat.error, isOpen, heldAt, jobState]);

  return (
    <ScrollViewport
      axis="vertical"
      aria-label={t("chat.messages")}
      containerClassName="min-h-0 flex-1"
      className="space-y-4 overflow-y-auto overscroll-contain p-4"
      role="log"
    >
      {count === 0 && !chat.isLoading ? (
        <p className="text-sm text-muted-foreground">{t("chat.empty")}</p>
      ) : null}
      {messages.map((message) => (
        <ChatMessageItem key={message.id} message={message} facts={facts} />
      ))}
      {live ? <ChatJobStatus live={live} isOpen={isOpen} /> : null}
      {quotaHold ? <ChatQuotaDemoAnswer hold={quotaHold} /> : null}
      {sending ? (
        <ChatMessageItem
          message={{
            role: "user",
            content: sending.text,
            attachments: sending.attachments,
          }}
        />
      ) : null}
      {sending && !chat.jobs.isRunning ? (
        <ChatLiveStatus startedAt={sending.startedAt} isOpen={isOpen} />
      ) : null}
      {chat.isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t("chat.loading")}
        </p>
      ) : null}
      {chat.commands.notice && chat.commands.notice !== "compacting" ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t(`chat.notice.${chat.commands.notice}`)}
        </p>
      ) : null}
      {chat.error ? (
        <p
          className="rounded-xl bg-destructive-subtle px-3 py-2 text-sm font-medium text-destructive"
          role="alert"
        >
          {chatErrorText(t, chat.error)}
        </p>
      ) : null}
      <div ref={end} />
    </ScrollViewport>
  );
}
