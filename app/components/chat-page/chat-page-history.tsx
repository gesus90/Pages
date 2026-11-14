import { CircleAlert, Clock, CornerDownRight, Wrench } from "lucide-react";
import { Fragment, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { cn } from "@/app/lib/cn";

import { MentionMarkdown } from "./mentions/mention-markdown";
import { useMentionDirectory } from "./mentions/mention-context";
import { ParticipantAvatar } from "./chat-page-avatar";
import { participantColors } from "./chat-page-colors";
import { ChatPageDecision } from "./chat-page-decision";
import { ChatPageToolUse } from "./chat-page-tool-uses";
import { ChatPageVoice } from "./chat-page-voice";
import { MessageContentView } from "./content/message-content-view";
import { MessageDelete } from "./content/message-delete";
import {
  answerToolSummary,
  ChatPageLiveAnswer,
  ChatPageThoughts,
} from "./live/chat-page-live-answer";
import { formatSeconds } from "./live/live-answer-state";

import type {
  VirtualChatMessage,
  VirtualParticipant,
  VirtualToolUse,
} from "@/definition/VirtualChat";
import type { LiveAnswerView, LiveDelivery } from "./live/live-answer-state";

/** What the history shows of the answers agents are writing (PAGE-381). */
export interface HistoryLive {
  /** The answers written now, after the stored messages. */
  readonly answers: readonly LiveAnswerView[];
  /** The answers that ended, by their stored message, for its folded details. */
  readonly ended: ReadonlyMap<string, LiveAnswerView>;
  /** How messages sent during an answer reached the agents, by message. */
  readonly deliveries: Readonly<Record<string, LiveDelivery>>;
  /** Names an agent of the chat. */
  readonly nameOf: (agentId: string) => string;
  /** The model label of an agent in this chat, such as "Opus 5.5 · hoch". */
  readonly modelOf?: (agentId: string) => string | undefined;
  /** Cancels the running tool calls of an agent. */
  readonly onCancelTool?: (agentId: string) => void;
}

const NO_LIVE: HistoryLive = {
  answers: [],
  ended: new Map(),
  deliveries: {},
  nameOf: (agentId) => agentId,
};

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

/** An agent outside the person's list, as a live answer names it. */
function liveAuthor(view: LiveAnswerView, live: HistoryLive): VirtualParticipant {
  return {
    id: view.agentId,
    name: live.nameOf(view.agentId),
    kind: "agent",
    role: "",
    username: "",
    color: null,
    avatarImageUrl: null,
    status: "working",
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

/** "Eds", "Max’", or "Ed's": the owner of an answer in the page's language. */
function possessive(name: string, language: string): string {
  if (language.startsWith("en")) return `${name}'s`;
  return /[sßxz]$/iu.test(name) ? `${name}’` : `${name}s`;
}

/** How a message sent during an answer reached the agents (PAGE-381). */
type MessageDelivery =
  | { readonly kind: "injected"; readonly agentIds: readonly string[] }
  | { readonly kind: "waiting"; readonly agentIds: readonly string[] }
  | { readonly kind: "failed" };

/** What the stream told last wins over what the history was read with. */
function deliveryOf(
  message: VirtualChatMessage,
  live: HistoryLive,
): MessageDelivery | null {
  const streamed = live.deliveries[message.id];
  if (streamed?.delivery === "failed") return { kind: "failed" };
  if (streamed)
    return { kind: streamed.delivery, agentIds: [streamed.agentId] };
  if (message.steeredInto && message.steeredInto.length > 0)
    return { kind: "injected", agentIds: message.steeredInto };
  if (message.queue === "chat") return { kind: "waiting", agentIds: [] };
  return null;
}

/**
 * Says how a message sent during an answer reached the agents (PAGE-381):
 * "in Eds Antwort eingeschoben", or "wartet · geht nach Eds Antwort raus".
 */
function DeliveryBadge({
  delivery,
  live,
}: {
  readonly delivery: MessageDelivery;
  readonly live: HistoryLive;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  if (delivery.kind === "failed")
    return (
      <p className="text-xs text-destructive" role="status">
        {t("chatPage.liveAnswer.notDelivered")}
      </p>
    );
  const owner = delivery.agentIds
    .map((id) => possessive(live.nameOf(id), i18n.language))
    .join(` ${t("chatPage.liveAnswer.and")} `);
  const isInjected = delivery.kind === "injected";
  let text = t("chatPage.liveAnswer.waitingAnyone");
  if (owner !== "")
    text = t(
      isInjected ? "chatPage.liveAnswer.injected" : "chatPage.liveAnswer.waiting",
      { owner },
    );
  return (
    <p
      className={cn(
        "inline-flex items-center gap-1 text-xs",
        isInjected ? "text-primary" : "text-muted-foreground",
      )}
      role="status"
    >
      {isInjected ? (
        <CornerDownRight aria-hidden="true" className="size-3.5 shrink-0" />
      ) : (
        <Clock aria-hidden="true" className="size-3.5 shrink-0" />
      )}
      {text}
    </p>
  );
}

/** The frame of an own message sent during an answer: orange when it went in, dashed while it waits. */
const DELIVERY_FRAMES: Readonly<Record<MessageDelivery["kind"], string>> = {
  injected: "rounded-[16px] ring-2 ring-primary ring-offset-2 ring-offset-background",
  waiting:
    "rounded-[16px] outline-dashed outline-2 outline-offset-2 outline-border",
  failed: "",
};

const OWN_BUBBLE =
  "max-w-[62%] min-w-0 rounded-[14px] rounded-br-[4px] bg-primary px-4 py-2.5 text-primary-foreground";

/** One own message: its text in primary bubbles, its cards between and below. */
function OwnMessage({
  message,
  live,
}: {
  readonly message: VirtualChatMessage;
  readonly live: HistoryLive;
}): React.ReactElement {
  const { t } = useTranslation();
  const delivery = deliveryOf(message, live);
  return (
    <article
      aria-label={t("chatPage.you")}
      className="group/message flex w-full min-w-0 flex-col items-end gap-2"
      data-delivery={delivery?.kind}
    >
      <div
        className={cn(
          "flex w-full min-w-0 flex-col items-end gap-2",
          delivery ? DELIVERY_FRAMES[delivery.kind] : undefined,
        )}
      >
      {message.voice ? (
        <div className={OWN_BUBBLE}>
          <ChatPageVoice voice={message.voice} text={message.content} isOwn />
        </div>
      ) : (
        <MessageContentView
          message={message}
          origin={{
            senderName: t("chatPage.cards.you"),
            createdAt: message.createdAt,
          }}
          renderText={(text) => (
            <MentionMarkdown
              className={cn(OWN_BUBBLE, "text-[15px]")}
              isDisplayableImage={hideImages}
              source={text}
            />
          )}
        />
      )}
      </div>
      {delivery ? (
        <DeliveryBadge delivery={delivery} live={live} />
      ) : (
        <QueueBadge queue={message.queue} />
      )}
      {message.canDelete === true ? (
        <MessageDelete messageId={message.id} />
      ) : null}
    </article>
  );
}

/** The person's own messages at the right, in primary bubbles. */
function OwnRun({
  messages,
  live,
}: {
  readonly messages: readonly VirtualChatMessage[];
  readonly live: HistoryLive;
}): React.ReactElement {
  return (
    <div className="flex flex-col items-end gap-2">
      {messages.map((message) => (
        <Fragment key={message.id}>
          <OwnMessage message={message} live={live} />
          {message.decision ? (
            <ChatPageDecision decision={message.decision} />
          ) : null}
        </Fragment>
      ))}
    </div>
  );
}

/** A stretch of the history: messages in runs, or one system line between them (PAGE-380). */
type HistorySegment =
  | { readonly kind: "messages"; readonly messages: VirtualChatMessage[] }
  | { readonly kind: "system"; readonly message: VirtualChatMessage };

/** Splits the history at its system lines, which never join a run of messages. */
function historySegments(
  messages: readonly VirtualChatMessage[],
): HistorySegment[] {
  const segments: HistorySegment[] = [];
  for (const message of messages) {
    if (message.notice === "session_event") {
      segments.push({ kind: "system", message });
      continue;
    }
    const last = segments.at(-1);
    if (last?.kind === "messages") last.messages.push(message);
    else segments.push({ kind: "messages", messages: [message] });
  }
  return segments;
}

/**
 * A system line every member sees (PAGE-380), such as "Igor hat Ed in diesem
 * Chat auf Claude Opus 5.5 · hoch umgestellt": centered between rules.
 */
function SystemLine({
  message,
}: {
  readonly message: VirtualChatMessage;
}): React.ReactElement {
  return (
    <p
      className="flex items-center gap-3 text-xs text-muted-foreground"
      role="note"
    >
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
      <span className="rounded-full border border-border bg-surface px-3 py-1 text-center">
        {message.content}
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </p>
  );
}

/** The voice message, or the hint why an agent did not answer (PAGE-276). */
function AnswerNotice({
  message,
  name,
}: {
  readonly message: VirtualChatMessage;
  readonly name: string;
}): React.ReactElement | null {
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
  return message.voice ? (
    <ChatPageVoice voice={message.voice} text={message.content} isOwn={false} />
  ) : null;
}

/** Name and role of the author, the first line of a run of answers. */
function AuthorLine({
  author,
}: {
  readonly author: VirtualParticipant;
}): React.ReactElement {
  const colors = participantColors(author.color);
  return (
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
  );
}

interface AnswerBubbleProps {
  readonly message: VirtualChatMessage;
  readonly author: VirtualParticipant;
  /** Shows name and role as first line, for the first answer of a run. */
  readonly hasName: boolean;
  /** The live answer this stored message ended, for its thoughts and tool times (PAGE-381). */
  readonly live?: LiveAnswerView;
}

/** A bubble in the author's color. */
function Bubble({
  author,
  children,
}: {
  readonly author: VirtualParticipant;
  readonly children: React.ReactNode;
}): React.ReactElement {
  const colors = participantColors(author.color);
  return (
    <div
      className={cn(
        "flex max-w-[62%] min-w-0 flex-col gap-1 rounded-[14px] rounded-bl-[4px] border px-4 py-2.5",
        colors.bubble.className,
      )}
      data-message-bubble=""
      style={colors.bubble.style}
    >
      {children}
    </div>
  );
}

/**
 * The tools an answer used, folded into one entry under it (PAGE-381), such
 * as "4 Werkzeuge · 3,1 s"; opened, every call with its result and time.
 */
function ToolUses({
  uses: stored,
  live,
}: {
  readonly uses: readonly VirtualToolUse[];
  readonly live?: LiveAnswerView;
}): React.ReactElement | null {
  const { t, i18n } = useTranslation();
  const { uses, durationMs } = answerToolSummary(stored, live?.tools);
  if (uses.length === 0) return null;
  const tools = t("chatPage.liveAnswer.tools", { count: uses.length });
  const summary =
    durationMs === null
      ? tools
      : t("chatPage.liveAnswer.toolsSummary", {
          tools,
          duration: formatSeconds(durationMs, i18n.language),
        });
  return (
    <details className="w-full max-w-[62%] min-w-0 text-xs">
      <summary className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-muted-foreground">
        <Wrench aria-hidden="true" className="size-3.5" />
        {summary}
      </summary>
      <ul
        aria-label={t("chatPage.toolUses")}
        className="mt-1.5 flex flex-col gap-1.5"
      >
        {uses.map((use) => (
          <ChatPageToolUse
            key={use.callId ?? `${use.name}:${use.detail}`}
            use={use}
            durationLabel={
              use.durationMs === undefined
                ? undefined
                : formatSeconds(use.durationMs, i18n.language)
            }
          />
        ))}
      </ul>
    </details>
  );
}

/**
 * One answer: its text in bubbles in the author's color, its cards between
 * and below them (PAGE-298), and the used tools at its foot.
 */
function AnswerBubble({
  message,
  author,
  hasName,
  live,
}: AnswerBubbleProps): React.ReactElement {
  const directory = useMentionDirectory();
  const isOwnMention =
    directory !== undefined &&
    message.mentions?.includes(directory.selfId) === true;
  const isPlain = message.notice === undefined && message.voice === undefined;
  // A message that starts with a card names its author above the card.
  const startsWithText = /^\s*(?!```|~~~|https?:\/\/\S+\s*(?:\n|$))\S/u.test(
    message.content,
  );
  const name = hasName ? <AuthorLine author={author} /> : null;
  return (
    <article
      aria-label={author.name}
      data-own-mention={isOwnMention ? "true" : undefined}
      className={cn(
        "flex w-full min-w-0 flex-col items-start gap-2",
        isOwnMention && "border-l-[3px] border-primary pl-2",
      )}
    >
      {live?.thought ? (
        <ChatPageThoughts thought={live.thought} isThinking={false} now={0} />
      ) : null}
      {isPlain ? (
        <>
          {startsWithText ? null : name}
          <MessageContentView
            message={message}
            origin={{ senderName: author.name, createdAt: message.createdAt }}
            renderText={(text, isFirst) => (
              <Bubble author={author}>
                {isFirst ? name : null}
                <MentionMarkdown
                  className="text-[15px] text-foreground"
                  isDisplayableImage={hideImages}
                  source={text}
                />
              </Bubble>
            )}
          />
        </>
      ) : (
        <Bubble author={author}>
          {name}
          <AnswerNotice message={message} name={author.name} />
        </Bubble>
      )}
      <ToolUses uses={message.toolUses} live={live} />
    </article>
  );
}

interface AnswerRunProps {
  readonly messages: readonly VirtualChatMessage[];
  readonly author: VirtualParticipant;
  readonly ended: ReadonlyMap<string, LiveAnswerView>;
}

/**
 * Consecutive answers of one participant at the left: the avatar once at the
 * top, the name in the person color above the first bubble, the bubbles 8 px
 * apart on the same indent.
 */
function AnswerRun({
  messages,
  author,
  ended,
}: AnswerRunProps): React.ReactElement {
  return (
    <div className="flex items-start gap-3">
      <ParticipantAvatar participant={author} size={32} />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
        {messages.map((message, index) => (
          <Fragment key={message.id}>
            <AnswerBubble
              message={message}
              author={author}
              hasName={index === 0}
              live={ended.get(message.id)}
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
  /** The answers agents are writing now and what they told (PAGE-381). */
  readonly live?: HistoryLive;
}

/**
 * The scrollable history of the opened group or participant: own messages
 * at the right, answers at the left in bubbles in the participant's color.
 * A stored history loads older pages from its head (PAGE-275).
 */
export function ChatPageHistory({
  messages: allMessages,
  name,
  findParticipant,
  isAnswering = false,
  older = NO_OLDER,
  answeringNames = [],
  live = NO_LIVE,
}: ChatPageHistoryProps): React.ReactElement {
  const { t } = useTranslation();
  const viewport = useRef<HTMLElement>(null);
  // A stored round_limit notice of PAGE-337 never shows: the talk just goes on (PAGE-349).
  const messages = allMessages.filter(
    (message) => message.notice !== "round_limit",
  );
  const newestId = messages.at(-1)?.id ?? null;
  // The growing live text keeps the foot in view, as a new message does.
  const liveLength = live.answers.reduce(
    (sum, view) => sum + view.text.length + view.tools.length,
    0,
  );

  // Keeps the newest message in view, as the Pica panel does; a loaded older
  // page leaves the position alone.
  useEffect(() => {
    const element = viewport.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [newestId, name, isAnswering, liveLength]);

  if (messages.length === 0 && !isAnswering && live.answers.length === 0)
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
      {historySegments(messages).flatMap((segment) =>
        segment.kind === "system"
          ? [<SystemLine key={segment.message.id} message={segment.message} />]
          : groupRuns(segment.messages).map((run) => {
              const [first] = run.messages;
              if (!first) return null;
              if (run.authorId === null)
                return (
                  <OwnRun key={first.id} messages={run.messages} live={live} />
                );
              const author = findParticipant(run.authorId) ?? authorOf(first);
              return author ? (
                <AnswerRun
                  key={first.id}
                  messages={run.messages}
                  author={author}
                  ended={live.ended}
                />
              ) : null;
            }),
      )}
      {live.answers.map((view) => {
        const author = findParticipant(view.agentId) ?? liveAuthor(view, live);
        const { onCancelTool } = live;
        return (
          <ChatPageLiveAnswer
            key={view.answerId}
            view={view}
            author={author}
            modelLabel={live.modelOf?.(view.agentId)}
            onCancelTool={
              onCancelTool ? () => onCancelTool(view.agentId) : undefined
            }
          />
        );
      })}
      {isAnswering && live.answers.length === 0 ? (
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
