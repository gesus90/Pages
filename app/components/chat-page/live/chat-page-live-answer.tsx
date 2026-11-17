import { Brain } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ChatLivePhraseLine } from "@/app/components/chat/chat-live-status";
import { cn } from "@/app/lib/cn";
import { AgentModelBadges } from "@/app/components/agents/badges/agent-model-badges";

import { MentionMarkdown } from "../mentions/mention-markdown";
import { ParticipantAvatar } from "../chat-page-avatar";
import { participantColors } from "../chat-page-colors";
import { ChatPageToolStrip } from "../chat-page-tool-strip";
import { GALLERY_TILES, GalleryPlaceholder } from "../content/image-gallery";
import {
  elapsedMilliseconds,
  formatSeconds,
  imageCount,
  isImageTool,
  toolsDuration,
} from "./live-answer-state";

import type {
  LiveAnswerThought,
  LiveAnswerTool,
} from "@/definition/ConversationLiveAnswer";
import type {
  VirtualParticipant,
  VirtualToolUse,
} from "@/definition/VirtualChat";
import type { AgentChatModelLabel } from "@/definition/AgentChatControl";
import type { LiveAnswerView } from "./live-answer-state";

/** How often the running times tick. */
const TICK_MILLISECONDS = 1_000;

function hideImages(): boolean {
  return false;
}

/** The current time, ticking once a second while `isRunning`. */
export function useTicking(isRunning: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isRunning) return undefined;
    const timer = window.setInterval(
      () => setNow(Date.now()),
      TICK_MILLISECONDS,
    );
    return () => window.clearInterval(timer);
  }, [isRunning]);
  return now;
}

/**
 * A call of a live answer as the tool list of the chat shows it, with how
 * long it ran or runs.
 */
export function liveToolUse(
  tool: LiveAnswerTool,
  now: number,
): VirtualToolUse & { readonly durationMs: number } {
  const end = tool.endedAt ?? new Date(now).toISOString();
  return {
    name: tool.name,
    detail: tool.error ?? "",
    callId: tool.callId,
    status: tool.status,
    durationMs: elapsedMilliseconds(tool.startedAt, end),
    ...(tool.input === undefined ? {} : { input: tool.input }),
    ...(tool.output === undefined ? {} : { output: tool.output }),
    ...(tool.isNative === true ? { isNative: true } : {}),
  };
}

/** The sentences of the waiting line of a live answer, in their order. */
const LIVE_PHRASE_KEYS = [
  "phrase1",
  "phrase2",
  "phrase3",
  "phrase4",
  "phrase5",
  "phrase6",
] as const;

/**
 * The thoughts of an answer for the one reader who may see them, in one
 * line of 20 px: "Denkt nach …" with the running time while the model
 * thinks, "Gedanken ·" with the time it thought after that.
 * @remarks
 * Both states are the same element, the brain keeps one place of 14 px and
 * the time a minimum width with figures of equal width, so the line never
 * changes its height and nothing in it moves. Once the model is done the
 * line opens the thoughts below it; they move only what stands below.
 */
export function ChatPageThoughts({
  thought,
  isThinking,
  now,
}: {
  readonly thought: LiveAnswerThought;
  readonly isThinking: boolean;
  readonly now: number;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const end = isThinking ? new Date(now).toISOString() : thought.endedAt;
  const duration = formatSeconds(
    elapsedMilliseconds(thought.startedAt, end),
    i18n.language,
  );

  // Nothing is there to read while the model still thinks.
  function handleSummaryClick(event: React.MouseEvent): void {
    if (isThinking) event.preventDefault();
  }

  return (
    <details
      className="group w-full max-w-[62%] min-w-0 text-xs text-muted-foreground"
      data-thoughts={isThinking ? "thinking" : "done"}
    >
      <summary
        className={cn(
          "flex h-5 list-none items-center gap-1.5 overflow-hidden whitespace-nowrap [&::-webkit-details-marker]:hidden",
          !isThinking && "cursor-pointer",
        )}
        role={isThinking ? "status" : undefined}
        onClick={handleSummaryClick}
      >
        <span
          aria-hidden="true"
          className="inline-flex size-3.5 shrink-0 items-center justify-center"
        >
          <Brain
            className={cn(
              "size-3.5",
              isThinking &&
                "animate-pulse text-primary motion-reduce:animate-none",
            )}
          />
        </span>
        <span
          className={cn(
            "shrink-0",
            isThinking && "font-medium text-foreground",
          )}
        >
          {isThinking
            ? t("chatPage.liveAnswer.thinkingNow")
            : `${t("chatPage.liveAnswer.thoughts")} ·`}
        </span>
        <span className="min-w-14 shrink-0 tabular-nums" data-elapsed="">
          {duration}
        </span>
        <span aria-hidden="true" className="shrink-0">
          ·
        </span>
        <span className="min-w-0 truncate">
          {t("chatPage.liveAnswer.onlyForYou")}
        </span>
      </summary>
      {isThinking ? null : (
        <p className="mt-1.5 border-l-2 border-border pl-3 whitespace-pre-wrap break-words">
          {thought.text}
        </p>
      )}
    </details>
  );
}

/** The time from the first start of a call to its last end, or to now while one runs. */
function runningToolsDuration(
  tools: readonly LiveAnswerTool[],
  now: number,
): number {
  const starts = tools.map((tool) => Date.parse(tool.startedAt));
  const ends = tools.map((tool) =>
    tool.endedAt === undefined ? now : Date.parse(tool.endedAt),
  );
  return Math.max(0, Math.max(...ends) - Math.min(...starts));
}

/**
 * The calls of a live answer folded into one line with the
 * running time; opened, each with its state, time and "Abbrechen" while it
 * runs.
 */
function LiveTools({
  tools,
  now,
  onCancel,
}: {
  readonly tools: readonly LiveAnswerTool[];
  readonly now: number;
  readonly onCancel?: () => void;
}): React.ReactElement | null {
  const { i18n } = useTranslation();
  if (tools.length === 0) return null;
  const uses = tools.map((tool) => liveToolUse(tool, now));
  return (
    <div className="flex w-full max-w-[62%] min-w-0">
      <ChatPageToolStrip
        uses={uses}
        durationLabel={formatSeconds(
          runningToolsDuration(tools, now),
          i18n.language,
        )}
        durationOf={(use) =>
          use.durationMs === undefined
            ? undefined
            : formatSeconds(use.durationMs, i18n.language)
        }
        onCancel={onCancel}
      />
    </div>
  );
}

/**
 * Where the text of a live answer stands: while the run goes on a line with
 * three pulsing dots and a sentence that changes every 20 s, never a growing
 * text with a caret; once it ended the whole answer at once.
 */
function LiveText({
  text,
  isRunning,
  now,
}: {
  readonly text: string;
  readonly isRunning: boolean;
  readonly now: number;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const [shownAt] = useState(() => Date.now());
  if (isRunning)
    return (
      <div className="flex w-full max-w-[62%] min-w-0" data-live-waiting="">
        <ChatLivePhraseLine
          phrases={LIVE_PHRASE_KEYS.map((key) =>
            t(`chatPage.liveAnswer.${key}`),
          )}
          elapsedSeconds={Math.floor((now - shownAt) / 1000)}
        />
      </div>
    );
  if (text === "") return null;
  return (
    <div className="flex max-w-[62%] min-w-0 flex-col">
      <MentionMarkdown
        className="text-[15px] text-foreground"
        isDisplayableImage={hideImages}
        source={text}
      />
    </div>
  );
}

/** Name, model and the hint "live" above a live answer, in one line of 24 px. */
function LiveAnswerHead({
  author,
  model,
  isRunning,
}: {
  readonly author: VirtualParticipant;
  readonly model: AgentChatModelLabel | undefined;
  readonly isRunning: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const colors = participantColors(author.color);
  return (
    <p
      className="flex h-6 max-w-full min-w-0 items-center gap-1.5 overflow-hidden text-[13px] whitespace-nowrap"
      data-live-head=""
    >
      <span
        className={cn(
          "truncate leading-5 font-semibold",
          colors.text.className,
        )}
        style={colors.text.style}
      >
        {author.name}
      </span>
      {model ? (
        <span className="inline-flex h-5 min-w-0 shrink-0 items-center">
          <AgentModelBadges model={model} />
        </span>
      ) : null}
      {isRunning ? (
        <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 text-[11px] leading-5 font-medium text-primary">
          <span
            aria-hidden="true"
            className="size-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none"
          />
          {t("chatPage.liveAnswer.live")}
        </span>
      ) : null}
    </p>
  );
}

interface ChatPageLiveAnswerProps {
  readonly view: LiveAnswerView;
  readonly author: VirtualParticipant;
  /** The model and reasoning level of the agent in this chat, as structured values. */
  readonly model?: AgentChatModelLabel;
  /** Cancels the running tool calls of this agent; absent where nobody may. */
  readonly onCancelTool?: () => void;
}

/**
 * The answer an agent is writing now: name, model and a "live"
 * hint above, an orange ring around the avatar, then its thoughts for the
 * reader allowed to see them, its tool calls and, while it runs, a line that
 * says the agent works; the text shows whole once the run ended.
 * @remarks
 * Every line has a fixed height and the lines stand 8 px apart, so a ticking
 * time or a changing symbol never moves another line.
 */
export function ChatPageLiveAnswer({
  view,
  author,
  model,
  onCancelTool,
}: ChatPageLiveAnswerProps): React.ReactElement {
  const { t } = useTranslation();
  const isRunning = view.end === null;
  const now = useTicking(isRunning);
  const isThinking =
    isRunning && view.thought !== null && view.lastAt === view.thought.endedAt;
  return (
    <article
      aria-label={t("chatPage.liveAnswer.liveAnswer", { name: author.name })}
      aria-busy={isRunning}
      className="flex items-start gap-3"
      data-live-answer={view.answerId}
    >
      <ParticipantAvatar
        participant={author}
        size={32}
        className={cn(
          "shrink-0 rounded-full",
          isRunning &&
            "ring-2 ring-primary ring-offset-2 ring-offset-background",
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
        <LiveAnswerHead author={author} model={model} isRunning={isRunning} />
        {view.thought ? (
          <ChatPageThoughts
            thought={view.thought}
            isThinking={isThinking}
            now={now}
          />
        ) : null}
        <LiveTools
          tools={view.tools}
          now={now}
          onCancel={isRunning ? onCancelTool : undefined}
        />
        <LiveText text={view.text} isRunning={isRunning} now={now} />
        {isRunning ? <GeneratingImages tools={view.tools} /> : null}
      </div>
    </article>
  );
}

/**
 * The placeholders of the images an agent is generating right now,
 * as the gallery of its answer will show them.
 */
function GeneratingImages({
  tools,
}: {
  readonly tools: readonly LiveAnswerTool[];
}): React.ReactElement | null {
  const { t } = useTranslation();
  const count = tools
    .filter((tool) => tool.status === "running" && isImageTool(tool))
    .reduce((total, tool) => total + imageCount(tool), 0);
  if (count === 0) return null;
  const shown = Math.min(count, GALLERY_TILES);
  return (
    <section
      aria-label={t("chatPage.liveAnswer.activity.generating", { count })}
      className="w-full max-w-108 rounded-xl border border-border bg-surface p-1"
      data-generating-images={count}
    >
      <p className="px-2 py-1.5 text-xs text-muted-foreground" role="status">
        {t("chatPage.liveAnswer.activity.generating", { count })}
      </p>
      <ul className="grid grid-cols-2 gap-1">
        {Array.from({ length: shown }, (_, index) => (
          <GalleryPlaceholder key={index} />
        ))}
      </ul>
    </section>
  );
}

/**
 * The tool calls of an ended answer for its folded entry: the
 * stored calls, with the times the page saw them run, and the time of all.
 *
 * @param uses - The calls stored with the answer; empty where none are stored.
 * @param live - The calls the page followed live, when it did.
 */
export function answerToolSummary(
  uses: readonly VirtualToolUse[],
  live: readonly LiveAnswerTool[] | undefined,
): {
  readonly uses: readonly VirtualToolUse[];
  readonly durationMs: number | null;
} {
  if (!live || live.length === 0) return { uses, durationMs: null };
  const now = Date.now();
  const timed = live.map((tool) => liveToolUse(tool, now));
  return {
    uses: uses.length > 0 ? withDurations(uses, timed) : timed,
    durationMs: toolsDuration(live),
  };
}

function withDurations(
  uses: readonly VirtualToolUse[],
  timed: readonly (VirtualToolUse & { readonly durationMs: number })[],
): VirtualToolUse[] {
  return uses.map((use) => {
    const match = timed.find((entry) => entry.callId === use.callId);
    return match ? { ...use, durationMs: match.durationMs } : use;
  });
}
