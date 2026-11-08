import { Zap } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { WikiMarkdown } from "@/app/components/wiki/wiki-markdown";
import { cn } from "@/app/lib/cn";

import { PARTICIPANT_TEXT_COLORS, ParticipantAvatar } from "./chat-page-avatar";

import type {
  VirtualChatMessage,
  VirtualParticipant,
  VirtualToolUse,
} from "@/definition/VirtualChat";

function hideImages(): boolean {
  return false;
}

function OwnMessage({
  message,
}: {
  readonly message: VirtualChatMessage;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <article aria-label={t("chatPage.you")} className="flex justify-end">
      <WikiMarkdown
        className="max-w-[85%] rounded-xl rounded-br-[4px] bg-primary px-4 py-2.5 text-[15px] text-primary-foreground"
        isDisplayableImage={hideImages}
        source={message.content}
      />
    </article>
  );
}

function ToolChip({
  use,
}: {
  readonly use: VirtualToolUse;
}): React.ReactElement {
  return (
    <li className="inline-flex items-center gap-1.5 rounded-lg bg-surface px-2 py-1 font-mono text-xs text-foreground shadow-xs">
      <Zap aria-hidden="true" className="size-3.5 text-primary" />
      {use.detail === "" ? use.name : `${use.name} · ${use.detail}`}
    </li>
  );
}

interface AnswerProps {
  readonly message: VirtualChatMessage;
  readonly author: VirtualParticipant;
  readonly isGroup: boolean;
}

/** An answer without bubble: avatar, the name in the participant's color, text and used tools. */
function Answer({ message, author, isGroup }: AnswerProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <article aria-label={author.name} className="flex gap-3">
      <ParticipantAvatar participant={author} size={32} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-[13px]">
          <span
            className={cn(
              "font-semibold",
              PARTICIPANT_TEXT_COLORS[author.color],
            )}
          >
            {author.name}
          </span>
          {isGroup ? (
            <span className="text-muted-foreground"> · {author.role}</span>
          ) : null}
        </p>
        <WikiMarkdown
          className="max-w-3xl text-[15px] text-foreground"
          isDisplayableImage={hideImages}
          source={message.content}
        />
        {message.toolUses.length > 0 ? (
          <ul
            aria-label={t("chatPage.toolUses")}
            className="mt-1 flex flex-wrap gap-2"
          >
            {message.toolUses.map((use) => (
              <ToolChip key={`${use.name}:${use.detail}`} use={use} />
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  );
}

interface ChatPageHistoryProps {
  readonly messages: readonly VirtualChatMessage[];
  readonly name: string;
  readonly isGroup: boolean;
  readonly findParticipant: (id: string) => VirtualParticipant | undefined;
}

/**
 * The scrollable history of the opened group or participant: own messages
 * at the right, answers at the left without bubble.
 */
export function ChatPageHistory({
  messages,
  name,
  isGroup,
  findParticipant,
}: ChatPageHistoryProps): React.ReactElement {
  const { t } = useTranslation();
  const viewport = useRef<HTMLElement>(null);

  // Keeps the newest message in view, as the Pica panel does.
  useEffect(() => {
    const element = viewport.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.length, name]);

  if (messages.length === 0)
    return (
      <p className="flex min-h-40 flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
        {t("chatPage.emptyHistory", { name })}
      </p>
    );

  return (
    <ScrollViewport
      ref={viewport}
      aria-label={t("chatPage.history", { name })}
      containerClassName="min-h-40 flex-1"
      className="flex flex-col gap-6 py-6 pr-1"
      role="log"
    >
      {messages.map((message) => {
        if (message.authorId === null)
          return <OwnMessage key={message.id} message={message} />;
        const author = findParticipant(message.authorId);
        return author ? (
          <Answer
            key={message.id}
            message={message}
            author={author}
            isGroup={isGroup}
          />
        ) : null;
      })}
    </ScrollViewport>
  );
}
