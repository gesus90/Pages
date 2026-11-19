import { CircleAlert, Wrench } from "lucide-react";
import { Fragment, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { cn } from "@/app/lib/cn";

import { MentionMarkdown } from "./mentions/mention-markdown";
import { useMentionDirectory } from "./mentions/mention-context";
import { ChatPageAnswerFailure } from "./chat-page-answer-failure";
import {
  ANSWER_CONTENT_CLASS,
  ANSWER_FRAME_CLASS,
  AnswerHead,
  answerAvatarClass,
} from "./chat-page-answer-head";
import { ParticipantAvatar } from "./chat-page-avatar";
import { participantColors } from "./chat-page-colors";
import { ChatPageDecision } from "./chat-page-decision";
import { hideImages, OwnRun, PreviewSentBadge } from "./chat-page-history-own";
import { groupRuns, knownAnswerModel } from "./chat-page-history-runs";
import { ChatPageQuestionCard } from "./chat-page-question-card";
import { ChatPageToolUse } from "./chat-page-tool-uses";
import { ChatPageVoice } from "./chat-page-voice";
import { MessageContentView } from "./content/message-content-view";
import { ChatAnswerDuration } from "./live/chat-answer-duration";
import {
  answerToolSummary,
  ChatPageLiveAnswer,
  ChatPageThoughts,
} from "./live/chat-page-live-answer";
import { formatSeconds } from "./live/live-answer-state";
import { useHistoryPosition } from "./use-history-position";
import { useMessageFocus } from "./use-message-focus";

import type {
  VirtualChatMessage,
  VirtualParticipant,
  VirtualToolUse,
} from "@/definition/VirtualChat";
import type { AgentChatModelLabel } from "@/definition/AgentChatControl";
import type { AgentModelBadgeValues } from "@/app/components/agents/badges/agent-model-badges";
import type { LiveAnswerView, LiveDelivery } from "./live/live-answer-state";

/** What the history shows of the answers agents are writing. */
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
  readonly modelOf?: (agentId: string) => AgentChatModelLabel | undefined;
  /** Cancels the running tool calls of an agent. */
  readonly onCancelTool?: (agentId: string) => void;
}

const NO_LIVE: HistoryLive = {
  answers: [],
  ended: new Map(),
  deliveries: {},
  nameOf: (agentId) => agentId,
};

/**
 * The author of a message from what the conversation tells, for one outside
 * the person's list.
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
function liveAuthor(
  view: LiveAnswerView,
  live: HistoryLive,
): VirtualParticipant {
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

/** A stretch of the history: messages in runs, or one system line between them. */
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
 * A system line every member sees, such as "Igor hat Ed in diesem
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

const FOCUS_MARK =
  "rounded-lg transition-shadow data-[message-focus=true]:ring-2 data-[message-focus=true]:ring-primary data-[message-focus=true]:ring-offset-4";

/**
 * The hint why an agent did not answer in a bubble, or the voice
 * message as a row of the sound grid outside the bubbles, so that it lines
 * up with the other voice messages.
 */
function AnswerNotice({
  message,
  author,
  nameLine,
}: {
  readonly message: VirtualChatMessage;
  readonly author: VirtualParticipant;
  /** Name and role above the first answer of a run. */
  readonly nameLine: React.ReactNode;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (message.notice)
    return (
      <Bubble author={author}>
        {nameLine}
        <p
          className="flex items-start gap-2 text-sm text-muted-foreground"
          role="note"
        >
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t(`chatPage.notice.${message.notice}`, { name: author.name })}
        </p>
        {message.notice === "agent_failed" &&
        message.createdAt !== undefined ? (
          <ChatPageAnswerFailure
            messageId={message.id}
            reason={message.content}
          />
        ) : null}
      </Bubble>
    );
  if (!message.voice) return null;
  return (
    <>
      {nameLine}
      <ChatPageVoice
        senderName={author.name}
        text={message.content}
        voice={message.voice}
      />
    </>
  );
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
  /** The live answer this stored message ended, for its thoughts and tool times. */
  readonly live?: LiveAnswerView;
}

/** A bubble in the author's color; an interim message is quieter. */
function Bubble({
  author,
  isQuiet = false,
  children,
}: {
  readonly author: VirtualParticipant;
  readonly isQuiet?: boolean;
  readonly children: React.ReactNode;
}): React.ReactElement {
  const colors = participantColors(author.color);
  return (
    <div
      className={cn(
        "flex max-w-[62%] min-w-0 flex-col gap-1 rounded-[14px] rounded-bl-[4px] border px-4 py-2.5",
        isQuiet
          ? "border-dashed bg-transparent py-1.5"
          : colors.bubble.className,
      )}
      data-message-bubble=""
      data-interim={isQuiet ? "true" : undefined}
      style={isQuiet ? undefined : colors.bubble.style}
    >
      {children}
    </div>
  );
}

/**
 * The tools an answer used, folded into one entry under it, such
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
  const { uses, durationMs } = answerToolSummary(stored, live);
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

/** The text of an answer in bubbles; an interim message quieter. */
function PlainAnswer({
  message,
  author,
  name,
  startsWithText,
}: {
  readonly message: VirtualChatMessage;
  readonly author: VirtualParticipant;
  readonly name: React.ReactNode;
  readonly startsWithText: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const isInterim = message.isInterim === true;
  return (
    <>
      {startsWithText ? null : name}
      <MessageContentView
        message={message}
        origin={{ senderName: author.name, createdAt: message.createdAt }}
        renderText={(text, isFirst) => (
          <Bubble author={author} isQuiet={isInterim}>
            {isFirst ? name : null}
            {isInterim ? (
              <span className="sr-only">{t("chatPage.interim")}</span>
            ) : null}
            <MentionMarkdown
              className={
                isInterim
                  ? "text-sm text-muted-foreground"
                  : "text-[15px] text-foreground"
              }
              isDisplayableImage={hideImages}
              source={text}
            />
          </Bubble>
        )}
      />
    </>
  );
}

/**
 * One answer: its text in bubbles in the author's color, its cards between
 * and below them, and the used tools at its foot.
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
      data-chat-message={message.id}
      data-message-id={message.id}
      data-own-mention={isOwnMention ? "true" : undefined}
      tabIndex={-1}
      className={cn(
        "flex w-full min-w-0 flex-col items-start gap-2 outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        FOCUS_MARK,
        isOwnMention && "border-l-[3px] border-primary pl-2",
      )}
    >
      {live?.thought ? (
        <ChatPageThoughts thought={live.thought} isThinking={false} now={0} />
      ) : null}
      {message.question ? (
        <>
          {name}
          <ChatPageQuestionCard question={message.question} />
        </>
      ) : null}
      {isPlain && !message.question ? (
        <PlainAnswer
          message={message}
          author={author}
          name={name}
          startsWithText={startsWithText}
        />
      ) : null}
      {isPlain ? null : (
        <AnswerNotice author={author} message={message} nameLine={name} />
      )}
      {message.isFromPreview === true ? <PreviewSentBadge /> : null}
      <ToolUses uses={message.toolUses} live={live} />
      {message.answerDurationMs === undefined ? null : (
        <ChatAnswerDuration durationMs={message.answerDurationMs} />
      )}
    </article>
  );
}

interface AnswerRunProps {
  readonly messages: readonly VirtualChatMessage[];
  readonly author: VirtualParticipant;
  readonly ended: ReadonlyMap<string, LiveAnswerView>;
  /** The model label of an agent in this chat, for an answer that ended on this page. */
  readonly modelOf?: (agentId: string) => AgentChatModelLabel | undefined;
}

/**
 * The model the head of a run of answers shows: the one kept with its first
 * answer, or the live snapshot while that metadata is being saved. Older
 * answers without model metadata and a matching live snapshot show none.
 */
function runModel(
  first: VirtualChatMessage,
  { ended, modelOf }: Pick<AnswerRunProps, "ended" | "modelOf">,
): AgentModelBadgeValues | undefined {
  const knownModel = knownAnswerModel(first, ended);
  if (knownModel) return knownModel;
  const view = ended.get(first.id);
  if (first.authorId === null || !view) return undefined;
  const model = modelOf?.(first.authorId);
  return model?.provider === "openrouter" ? undefined : model;
}

/**
 * Consecutive answers of one participant at the left: the avatar once at the
 * top, the name in the person color above the first bubble, the bubbles 8 px
 * apart on the same indent.
 * @remarks
 * A run whose first answer knows its model starts with the head of a live
 * answer, without "live": name, model, "Free" and reasoning.
 */
function AnswerRun({
  messages,
  author,
  ended,
  modelOf,
}: AnswerRunProps): React.ReactElement {
  const [first] = messages;
  const model = first ? runModel(first, { ended, modelOf }) : undefined;
  const hasHead = model !== undefined;
  return (
    <div className={ANSWER_FRAME_CLASS}>
      <ParticipantAvatar
        participant={author}
        size={36}
        className={answerAvatarClass(hasHead)}
      />
      {hasHead ? <AnswerHead author={author} model={model} hasRole /> : null}
      <div className={ANSWER_CONTENT_CLASS}>
        {messages.map((message, index) => (
          <Fragment key={message.id}>
            <AnswerBubble
              message={message}
              author={author}
              hasName={index === 0 && !hasHead}
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

/** The stored messages in runs of one author, with a system line between them. */
function StoredMessages({
  messages,
  findParticipant,
  live,
}: {
  readonly messages: readonly VirtualChatMessage[];
  readonly findParticipant: (id: string) => VirtualParticipant | undefined;
  readonly live: HistoryLive;
}): React.ReactElement {
  return (
    <>
      {historySegments(messages).flatMap((segment) =>
        segment.kind === "system"
          ? [<SystemLine key={segment.message.id} message={segment.message} />]
          : groupRuns(segment.messages, live.ended).map((run) => {
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
                  modelOf={live.modelOf}
                />
              ) : null;
            }),
      )}
    </>
  );
}

/** The older pages of a stored history, loaded on request. */
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

/** The place of a history without messages: empty, or still on its way. */
function EmptyHistory({
  name,
  isLoading,
}: {
  readonly name: string;
  readonly isLoading: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <p
      className="flex min-h-40 flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground"
      role={isLoading ? "status" : undefined}
    >
      {isLoading
        ? t("chatPage.historyLoading", { name })
        : t("chatPage.emptyHistory", { name })}
    </p>
  );
}

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
  /** The answers agents are writing now and what they told. */
  readonly live?: HistoryLive;
  /** The message a "Zur Nachricht" link points to; shown and marked once. */
  readonly focusMessageId?: string;
  /** Whether the history is on its way, so its absence says nothing yet. */
  readonly isLoading?: boolean;
  /** The key of the opened chat, which its reading position is kept under. */
  readonly chatKey: string;
  /** Where the person stopped reading in each chat, by chat key. */
  readonly readingPositions: Readonly<Record<string, string>> | undefined;
}

/**
 * The scrollable history of the opened group or participant: own messages
 * at the right, answers at the left in bubbles in the participant's color.
 * A stored history loads older pages from its head, and opens where the
 * person stopped reading.
 */
export function ChatPageHistory({
  messages: allMessages,
  name,
  findParticipant,
  isAnswering = false,
  older = NO_OLDER,
  answeringNames = [],
  live = NO_LIVE,
  focusMessageId,
  isLoading,
  chatKey,
  readingPositions,
}: ChatPageHistoryProps): React.ReactElement {
  const { t } = useTranslation();
  const viewport = useRef<HTMLElement>(null);
  // A stored round_limit notice never shows: the talk just goes on.
  const messages = allMessages.filter(
    (message) => message.notice !== "round_limit",
  );
  const newestId = messages.at(-1)?.id ?? null;
  // The growing live text keeps the foot in view, as a new message does.
  const liveLength = live.answers.reduce(
    (sum, view) => sum + view.text.length + view.tools.length,
    0,
  );

  const messageIds = messages.map((message) => message.id);
  // Opens where the person stopped reading and keeps the newest message in
  // view while they read at the foot; a loaded older page leaves the position
  // alone.
  useHistoryPosition(viewport, {
    chatKey,
    stored: readingPositions,
    messageIds,
    hasFocusRequest: focusMessageId !== undefined,
    older,
    foot: {
      newestId,
      isOwn: messages.at(-1)?.authorId === null,
      growth: `${name}:${String(isAnswering)}:${String(liveLength)}`,
    },
  });
  useMessageFocus(viewport, {
    messageId: focusMessageId,
    messageIds,
    older,
  });

  if (messages.length === 0 && !isAnswering && live.answers.length === 0)
    return <EmptyHistory name={name} isLoading={isLoading === true} />;

  return (
    <ScrollViewport
      ref={viewport}
      aria-label={t("chatPage.history", { name })}
      containerClassName="min-h-40 flex-1"
      className="flex flex-col gap-4 px-4 py-6"
      role="log"
    >
      <OlderButton older={older} />
      <StoredMessages
        messages={messages}
        findParticipant={findParticipant}
        live={live}
      />
      {live.answers.map((view) => {
        const author = findParticipant(view.agentId) ?? liveAuthor(view, live);
        const { onCancelTool } = live;
        return (
          <ChatPageLiveAnswer
            key={view.answerId}
            view={view}
            author={author}
            model={live.modelOf?.(view.agentId)}
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
