import { Zap } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { WikiMarkdown } from "@/app/components/wiki/wiki-markdown";
import { cn } from "@/app/lib/cn";

import { ParticipantAvatar } from "./chat-page-avatar";
import { participantColors } from "./chat-page-colors";

import type {
  VirtualChatMessage,
  VirtualParticipant,
  VirtualToolUse,
} from "@/definition/VirtualChat";

function hideImages(): boolean {
  return false;
}

/** Consecutive messages of one author: `null` for the person's own messages. */
interface MessageRun {
  readonly authorId: string | null;
  readonly messages: readonly VirtualChatMessage[];
}

function groupRuns(messages: readonly VirtualChatMessage[]): MessageRun[] {
  const runs: MessageRun[] = [];
  for (const message of messages) {
    const last = runs.at(-1);
    if (last && last.authorId === message.authorId)
      runs[runs.length - 1] = {
        authorId: last.authorId,
        messages: [...last.messages, message],
      };
    else runs.push({ authorId: message.authorId, messages: [message] });
  }
  return runs;
}

/** The person's own messages at the right, in primary bubbles. */
function OwnRun({
  messages,
}: {
  readonly messages: readonly VirtualChatMessage[];
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-end gap-2">
      {messages.map((message) => (
        <article
          key={message.id}
          aria-label={t("chatPage.you")}
          className="flex max-w-[62%] justify-end"
        >
          <WikiMarkdown
            className="min-w-0 rounded-[14px] rounded-br-[4px] bg-primary px-4 py-2.5 text-[15px] text-primary-foreground"
            isDisplayableImage={hideImages}
            source={message.content}
          />
        </article>
      ))}
    </div>
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

interface AnswerBubbleProps {
  readonly message: VirtualChatMessage;
  readonly author: VirtualParticipant;
  /** Shows name and role as first line, for the first answer of a run. */
  readonly hasName: boolean;
}

/** One answer in a bubble in the author's color, with the used tools at its foot. */
function AnswerBubble({
  message,
  author,
  hasName,
}: AnswerBubbleProps): React.ReactElement {
  const { t } = useTranslation();
  const colors = participantColors(author.color);
  return (
    <article
      aria-label={author.name}
      className={cn(
        "flex max-w-full min-w-0 flex-col gap-1 rounded-[14px] rounded-bl-[4px] border px-4 py-2.5",
        colors.bubble.className,
      )}
      style={colors.bubble.style}
    >
      {hasName ? (
        <p className="text-[13px]">
          <span
            className={cn("font-semibold", colors.text.className)}
            style={colors.text.style}
          >
            {author.name}
          </span>
          <span className="text-muted-foreground"> · {author.role}</span>
        </p>
      ) : null}
      <WikiMarkdown
        className="text-[15px] text-foreground"
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
    </article>
  );
}

interface AnswerRunProps {
  readonly messages: readonly VirtualChatMessage[];
  readonly author: VirtualParticipant;
}

/**
 * Consecutive answers of one participant at the left: the avatar once at the
 * top, the name in the person color above the first bubble, the bubbles 8 px
 * apart on the same indent.
 */
function AnswerRun({ messages, author }: AnswerRunProps): React.ReactElement {
  return (
    <div className="flex items-start gap-3">
      <ParticipantAvatar participant={author} size={32} />
      <div className="flex max-w-[62%] min-w-0 flex-col items-start gap-2">
        {messages.map((message, index) => (
          <AnswerBubble
            key={message.id}
            message={message}
            author={author}
            hasName={index === 0}
          />
        ))}
      </div>
    </div>
  );
}

interface ChatPageHistoryProps {
  readonly messages: readonly VirtualChatMessage[];
  readonly name: string;
  readonly findParticipant: (id: string) => VirtualParticipant | undefined;
  /** Shows that the agent is answering at the foot of the history. */
  readonly isAnswering?: boolean;
}

/**
 * The scrollable history of the opened group or participant: own messages
 * at the right, answers at the left in bubbles in the participant's color.
 */
export function ChatPageHistory({
  messages,
  name,
  findParticipant,
  isAnswering = false,
}: ChatPageHistoryProps): React.ReactElement {
  const { t } = useTranslation();
  const viewport = useRef<HTMLElement>(null);

  // Keeps the newest message in view, as the Pica panel does.
  useEffect(() => {
    const element = viewport.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.length, name, isAnswering]);

  if (messages.length === 0 && !isAnswering)
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
      className="flex flex-col gap-4 py-6 pr-1"
      role="log"
    >
      {groupRuns(messages).map((run) => {
        const [first] = run.messages;
        if (!first) return null;
        if (run.authorId === null)
          return <OwnRun key={first.id} messages={run.messages} />;
        const author = findParticipant(run.authorId);
        return author ? (
          <AnswerRun key={first.id} messages={run.messages} author={author} />
        ) : null;
      })}
      {isAnswering ? (
        <p
          className="animate-pulse text-sm text-muted-foreground"
          role="status"
        >
          {t("chatPage.answering", { name })}
        </p>
      ) : null}
    </ScrollViewport>
  );
}
