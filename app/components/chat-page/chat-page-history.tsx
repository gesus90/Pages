import { CircleAlert, Clock } from "lucide-react";
import { Fragment, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { WikiMarkdown } from "@/app/components/wiki/wiki-markdown";
import { cn } from "@/app/lib/cn";

import { ParticipantAvatar } from "./chat-page-avatar";
import { participantColors } from "./chat-page-colors";
import { ChatPageDecision } from "./chat-page-decision";
import { ChatPageToolUse } from "./chat-page-tool-uses";
import { ChatPageVoice } from "./chat-page-voice";

import type {
  VirtualChatMessage,
  VirtualParticipant,
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

/**
 * The author of a message from what the conversation tells, for one outside
 * the person's list (PAGE-278).
 */
function authorOf(message: VirtualChatMessage): VirtualParticipant | null {
  if (!message.author || message.authorId === null) return null;
  return {
    id: message.authorId,
    name: message.author.name,
    kind: message.author.kind,
    role: "",
    username: "",
    color: message.author.color,
    avatarImageUrl: null,
    status: "active",
    unreadCount: 0,
    canChat: false,
    lastActivityAt: "",
  };
}

/**
 * Says that the answer to a message waits (PAGE-304): for the answer the
 * agent gives in this chat, or for a free place among the session limits.
 */
function QueueBadge({
  queue,
}: {
  readonly queue: VirtualChatMessage["queue"];
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (queue === undefined) return null;
  return (
    <p
      className="inline-flex items-center gap-1 text-xs text-muted-foreground"
      role="status"
    >
      <Clock aria-hidden="true" className="size-3.5 shrink-0" />
      {t(`chatPage.queue.${queue}`)}
    </p>
  );
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
        <Fragment key={message.id}>
          <article
            aria-label={t("chatPage.you")}
            className="flex max-w-[62%] flex-col items-end gap-1"
          >
            {message.voice ? (
              <div className="min-w-0 rounded-[14px] rounded-br-[4px] bg-primary px-4 py-2.5 text-primary-foreground">
                <ChatPageVoice
                  voice={message.voice}
                  text={message.content}
                  isOwn
                />
              </div>
            ) : (
              <WikiMarkdown
                className="min-w-0 rounded-[14px] rounded-br-[4px] bg-primary px-4 py-2.5 text-[15px] text-primary-foreground"
                isDisplayableImage={hideImages}
                source={message.content}
              />
            )}
            <QueueBadge queue={message.queue} />
          </article>
          {message.decision ? (
            <ChatPageDecision decision={message.decision} />
          ) : null}
        </Fragment>
      ))}
    </div>
  );
}

/** The text, the voice message, or the hint why an agent did not answer (PAGE-276). */
function AnswerContent({
  message,
  name,
}: {
  readonly message: VirtualChatMessage;
  readonly name: string;
}): React.ReactElement {
  const { t } = useTranslation();
  if (message.notice)
    return (
      <p
        className="flex items-start gap-2 text-sm text-muted-foreground"
        role="note"
      >
        <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {t(`chatPage.notice.${message.notice}`, { name })}
      </p>
    );
  if (message.voice)
    return (
      <ChatPageVoice
        voice={message.voice}
        text={message.content}
        isOwn={false}
      />
    );
  return (
    <WikiMarkdown
      className="text-[15px] text-foreground"
      isDisplayableImage={hideImages}
      source={message.content}
    />
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
          {author.role === "" ? null : (
            <span className="text-muted-foreground"> · {author.role}</span>
          )}
        </p>
      ) : null}
      <AnswerContent message={message} name={author.name} />
      {message.toolUses.length > 0 ? (
        <ul
          aria-label={t("chatPage.toolUses")}
          className="mt-1 flex flex-col gap-1.5"
        >
          {message.toolUses.map((use) => (
            <ChatPageToolUse
              key={use.callId ?? `${use.name}:${use.detail}`}
              use={use}
            />
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
          <Fragment key={message.id}>
            <AnswerBubble
              message={message}
              author={author}
              hasName={index === 0}
            />
            {message.decision ? (
              <ChatPageDecision decision={message.decision} />
            ) : null}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/** The older pages of a stored history, loaded on request (PAGE-275). */
interface OlderMessages {
  readonly hasMore: boolean;
  readonly isLoading: boolean;
  readonly onLoad: () => void;
}

/** The button at the head of the history that loads the page before it. */
function OlderButton({
  older,
}: {
  readonly older: OlderMessages;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!older.hasMore) return null;
  return (
    <div className="flex justify-center">
      <Button
        disabled={older.isLoading}
        onClick={older.onLoad}
        size="sm"
        type="button"
        variant="outline"
      >
        {older.isLoading ? t("chatPage.loadingOlder") : t("chatPage.loadOlder")}
      </Button>
    </div>
  );
}

const NO_OLDER: OlderMessages = {
  hasMore: false,
  isLoading: false,
  onLoad: () => undefined,
};

interface ChatPageHistoryProps {
  readonly messages: readonly VirtualChatMessage[];
  readonly name: string;
  readonly findParticipant: (id: string) => VirtualParticipant | undefined;
  /** Shows that the agent is answering at the foot of the history. */
  readonly isAnswering?: boolean;
  /** The older pages of a stored conversation; agents have none. */
  readonly older?: OlderMessages;
  /** Who is answering; the conversation's name by default. */
  readonly answeringNames?: readonly string[];
}

/**
 * The scrollable history of the opened group or participant: own messages
 * at the right, answers at the left in bubbles in the participant's color.
 * A stored history loads older pages from its head (PAGE-275).
 */
export function ChatPageHistory({
  messages,
  name,
  findParticipant,
  isAnswering = false,
  older = NO_OLDER,
  answeringNames = [],
}: ChatPageHistoryProps): React.ReactElement {
  const { t } = useTranslation();
  const viewport = useRef<HTMLElement>(null);
  const newestId = messages.at(-1)?.id ?? null;

  // Keeps the newest message in view, as the Pica panel does; a loaded older
  // page leaves the position alone.
  useEffect(() => {
    const element = viewport.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [newestId, name, isAnswering]);

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
      <OlderButton older={older} />
      {groupRuns(messages).map((run) => {
        const [first] = run.messages;
        if (!first) return null;
        if (run.authorId === null)
          return <OwnRun key={first.id} messages={run.messages} />;
        const author = findParticipant(run.authorId) ?? authorOf(first);
        return author ? (
          <AnswerRun key={first.id} messages={run.messages} author={author} />
        ) : null;
      })}
      {isAnswering ? (
        <p
          className="animate-pulse text-sm text-muted-foreground"
          role="status"
        >
          {answeringNames.length > 1
            ? t("chatPage.answeringMany", { names: answeringNames.join(", ") })
            : t("chatPage.answering", { name: answeringNames[0] ?? name })}
        </p>
      ) : null}
    </ScrollViewport>
  );
}
