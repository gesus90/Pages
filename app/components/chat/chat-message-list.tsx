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
}

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

/** The conversation of the open session, newest at the bottom. */
export function ChatMessageList({
  chat,
}: ChatMessageListProps): React.ReactElement {
  const { t } = useTranslation();
  const end = useRef<HTMLDivElement>(null);
  const { messages } = chat.view;
  const count = messages.length + (chat.sending ? 1 : 0);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [count]);

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
      {chat.sending ? (
        <ChatMessageItem
          message={{
            role: "user",
            content: chat.sending.text,
            attachments: [],
          }}
        />
      ) : null}
      {chat.isLoading || chat.sending ? (
        <p className="text-sm text-muted-foreground" role="status">
          {chat.isLoading ? t("chat.loading") : t("chat.thinking")}
        </p>
      ) : null}
      {chat.commands.notice ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t(`chat.notice.${chat.commands.notice}`)}
        </p>
      ) : null}
      {chat.error ? (
        <p className="text-sm text-destructive" role="alert">
          {chatErrorText(t, chat.error)}
        </p>
      ) : null}
      <div ref={end} />
    </div>
  );
}
