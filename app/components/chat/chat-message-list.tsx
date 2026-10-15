import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { WikiMarkdown } from "@/app/components/wiki/wiki-markdown";
import { cn } from "@/app/lib/cn";

import picaIconUrl from "@/assets/pica-icon.svg";

import { ChatAttachmentList } from "./chat-attachment-list";
import { chatErrorText } from "./chat-error";

import type { ChatMessage } from "@/definition/Chat";
import type { ChatController } from "./use-chat";

interface ChatMessageListProps {
  readonly chat: ChatController;
  readonly isOpen: boolean;
}

/** Start offsets of the three dots, so they light up one after the other. */
const DOT_DELAYS = [
  "[animation-delay:0ms]",
  "[animation-delay:300ms]",
  "[animation-delay:600ms]",
] as const;

function hideImages(): boolean {
  return false;
}

/** One message; answers and own messages both render Markdown and code blocks (T6.12.10). */
function ChatMessageItem({
  message,
}: {
  readonly message: Pick<ChatMessage, "role" | "content" | "attachments">;
}): React.ReactElement {
  const { t } = useTranslation();
  const isOwn = message.role === "user";
  return (
    <article
      aria-label={isOwn ? t("chat.you") : t("chat.title")}
      className={cn("flex gap-2", isOwn ? "justify-end" : "justify-start")}
    >
      {isOwn ? null : (
        <img
          alt=""
          className="mt-1 size-7 shrink-0 rounded-lg"
          src={picaIconUrl}
        />
      )}
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
      </div>
    </article>
  );
}

/** Pica's row while the answer runs (T6.12.1): avatar, moving dots and "Pica antwortet …". */
function ChatAnswerPending(): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2" role="status">
      <img alt="" className="size-7 shrink-0 rounded-lg" src={picaIconUrl} />
      <p className="flex items-center gap-2.5 rounded-2xl bg-surface px-3 py-2 text-sm font-medium ring-1 ring-border">
        <span aria-hidden="true" className="flex gap-1">
          {DOT_DELAYS.map((delay) => (
            <span
              key={delay}
              className={cn(
                "size-2 animate-pulse rounded-full bg-primary motion-reduce:animate-none",
                delay,
              )}
            />
          ))}
        </span>
        {t("chat.thinking")}
      </p>
    </div>
  );
}

/** The conversation of the open session, newest at the bottom. */
export function ChatMessageList({
  chat,
  isOpen,
}: ChatMessageListProps): React.ReactElement {
  const { t } = useTranslation();
  const end = useRef<HTMLDivElement>(null);
  const { messages, session } = chat.view;
  // A message is only shown in the session it was sent to.
  const sending =
    chat.sending !== null && chat.sending.sessionId === session?.id
      ? chat.sending
      : null;
  const count = messages.length + (sending ? 1 : 0);

  useEffect(() => {
    // A hidden panel cannot scroll, so reopening it shows what arrived meanwhile.
    if (isOpen) end.current?.scrollIntoView({ block: "end" });
  }, [count, chat.error, isOpen]);

  return (
    <div
      aria-label={t("chat.messages")}
      className="pages-thin-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4"
      role="log"
    >
      {count === 0 && !chat.isLoading ? (
        <p className="text-sm text-muted-foreground">{t("chat.empty")}</p>
      ) : null}
      {messages.map((message) => (
        <ChatMessageItem key={message.id} message={message} />
      ))}
      {sending ? (
        <ChatMessageItem
          message={{ role: "user", content: sending.text, attachments: [] }}
        />
      ) : null}
      {sending ? <ChatAnswerPending /> : null}
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
    </div>
  );
}
