import { Brain } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { MentionMarkdown } from "../mentions/mention-markdown";
import { ParticipantAvatar } from "../chat-page-avatar";
import { participantColors } from "../chat-page-colors";
import { ChatPageToolUse } from "../chat-page-tool-uses";
import {
  elapsedMilliseconds,
  formatSeconds,
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
import type { LiveAnswerView } from "./live-answer-state";

/** How often the text of a live answer shows its next word. */
const WORD_MILLISECONDS = 35;
/** How often the running times tick. */
const TICK_MILLISECONDS = 1_000;

function hideImages(): boolean {
  return false;
}

/** The end of the next word after a position, with the space after it. */
function nextWordEnd(text: string, from: number): number {
  const match = /\s*\S+\s*/uy;
  match.lastIndex = from;
  return match.exec(text) ? match.lastIndex : text.length;
}

/**
 * Reveals a growing text word by word, as it was written (PAGE-381).
 *
 * @remarks
 * The server sends complete words in short bursts; the page shows them one
 * after the other. A text that no longer continues the shown one, such as
 * the next message after a tool call, starts anew.
 */
export function useRevealedText(text: string): string {
  const [shown, setShown] = useState(text);
  const isBehind = shown.length < text.length && text.startsWith(shown);
  const visible = text.startsWith(shown) ? shown : "";
  useEffect(() => {
    if (!text.startsWith(shown)) {
      setShown("");
      return undefined;
    }
    if (!isBehind) return undefined;
    const timer = window.setTimeout(() => {
      setShown(text.slice(0, nextWordEnd(text, shown.length)));
    }, WORD_MILLISECONDS);
    return () => window.clearTimeout(timer);
  }, [text, shown, isBehind]);
  return visible;
}

/** The current time, ticking once a second while `isRunning`. */
export function useTicking(isRunning: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isRunning) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MILLISECONDS);
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

/**
 * The thoughts of an answer for the one reader who may see them: a hint
 * with the running time while the model thinks, folded "Gedanken · 12 s"
 * after that (PAGE-381).
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
  if (isThinking)
    return (
      <p
        className="inline-flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
        role="status"
      >
        <Brain aria-hidden="true" className="size-3.5 animate-pulse text-primary" />
        <span className="font-medium text-foreground">
          {t("chatPage.liveAnswer.thinkingNow")}
        </span>
        <span>{duration}</span>
        <span aria-hidden="true">·</span>
        <span>{t("chatPage.liveAnswer.onlyForYou")}</span>
      </p>
    );
  return (
    <details className="group w-full max-w-[62%] min-w-0 text-xs text-muted-foreground">
      <summary className="inline-flex cursor-pointer items-center gap-1.5">
        <Brain aria-hidden="true" className="size-3.5" />
        {t("chatPage.liveAnswer.thoughtsSummary", { duration })}
        <span aria-hidden="true">·</span>
        <span>{t("chatPage.liveAnswer.onlyForYou")}</span>
      </summary>
      <p className="mt-1.5 border-l-2 border-border pl-3 whitespace-pre-wrap break-words">
        {thought.text}
      </p>
    </details>
  );
}

/** The calls of a live answer, each with its state, time and "Abbrechen" while it runs. */
function LiveTools({
  tools,
  now,
  onCancel,
}: {
  readonly tools: readonly LiveAnswerTool[];
  readonly now: number;
  readonly onCancel?: () => void;
}): React.ReactElement | null {
  const { t, i18n } = useTranslation();
  if (tools.length === 0) return null;
  return (
    <ul
      aria-label={t("chatPage.liveTools")}
      className="flex w-full max-w-[62%] min-w-0 flex-col gap-1.5"
    >
      {tools.map((tool) => {
        const use = liveToolUse(tool, now);
        return (
          <ChatPageToolUse
            key={tool.callId}
            use={use}
            durationLabel={formatSeconds(use.durationMs, i18n.language)}
            onCancel={onCancel}
          />
        );
      })}
    </ul>
  );
}

/** The text of a live answer, revealed word by word with a blinking caret. */
function LiveText({
  text,
  isWriting,
}: {
  readonly text: string;
  readonly isWriting: boolean;
}): React.ReactElement | null {
  const shown = useRevealedText(text);
  if (shown === "" && !isWriting) return null;
  return (
    <div className="flex max-w-[62%] min-w-0 flex-col gap-1 py-1">
      <MentionMarkdown
        className="text-[15px] text-foreground"
        isDisplayableImage={hideImages}
        source={isWriting ? `${shown}▍` : shown}
      />
    </div>
  );
}

interface ChatPageLiveAnswerProps {
  readonly view: LiveAnswerView;
  readonly author: VirtualParticipant;
  /** The model and reasoning level of the agent in this chat, such as "Opus 5.5 · hoch". */
  readonly modelLabel?: string;
  /** Cancels the running tool calls of this agent; absent where nobody may. */
  readonly onCancelTool?: () => void;
}

/**
 * The answer an agent is writing now (PAGE-381): name, model and a "live"
 * hint above, an orange ring around the avatar, then its thoughts for the
 * reader allowed to see them, its tool calls and the text as it grows.
 */
export function ChatPageLiveAnswer({
  view,
  author,
  modelLabel,
  onCancelTool,
}: ChatPageLiveAnswerProps): React.ReactElement {
  const { t } = useTranslation();
  const isRunning = view.end === null;
  const now = useTicking(isRunning);
  const colors = participantColors(author.color);
  const isThinking =
    isRunning && view.thought !== null && view.lastAt === view.thought.endedAt;
  const hasRunningTool = view.tools.some((tool) => tool.status === "running");
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
          isRunning && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
        <p className="flex flex-wrap items-center gap-1.5 text-[13px]">
          <span
            className={cn("font-semibold", colors.text.className)}
            style={colors.text.style}
          >
            {author.name}
          </span>
          {modelLabel ? (
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
              {modelLabel}
            </span>
          ) : null}
          {isRunning ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              <span
                aria-hidden="true"
                className="size-1.5 animate-pulse rounded-full bg-primary"
              />
              {view.text === "" || hasRunningTool
                ? t("chatPage.liveAnswer.working")
                : t("chatPage.liveAnswer.live")}
            </span>
          ) : null}
        </p>
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
        <LiveText text={view.text} isWriting={isRunning} />
      </div>
    </article>
  );
}

/**
 * The tool calls of an ended answer for its folded entry (PAGE-381): the
 * stored calls, with the times the page saw them run, and the time of all.
 *
 * @param uses - The calls stored with the answer; empty where none are stored.
 * @param live - The calls the page followed live, when it did.
 */
export function answerToolSummary(
  uses: readonly VirtualToolUse[],
  live: readonly LiveAnswerTool[] | undefined,
): { readonly uses: readonly VirtualToolUse[]; readonly durationMs: number | null } {
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
