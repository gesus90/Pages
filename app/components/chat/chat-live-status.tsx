import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { PicaMascot } from "./pica-mascot";
import { formatChatElapsed, useChatElapsed } from "./use-chat-elapsed";

const DOT_DELAYS = [
  "[animation-delay:0ms]",
  "[animation-delay:300ms]",
  "[animation-delay:600ms]",
] as const;
const PICA_PHRASES = [
  "phrase1",
  "phrase2",
  "phrase3",
  "phrase4",
  "phrase5",
] as const;
/** How long each sentence of a waiting line stands before the next one follows. */
export const LIVE_PHRASE_INTERVAL_SECONDS = 20;

interface ChatLiveStatusProps {
  readonly startedAt: number;
  readonly isOpen: boolean;
}

/**
 * The sentence a waiting line shows after some time: each stands for 20 s,
 * in their order, then the first follows again.
 * @param phrases - The sentences, already translated.
 * @param elapsedSeconds - How long the line has been shown.
 * @returns An empty text when there is no sentence.
 */
export function livePhraseAt(
  phrases: readonly string[],
  elapsedSeconds: number,
): string {
  if (phrases.length === 0) return "";
  const step = Math.floor(
    Math.max(0, elapsedSeconds) / LIVE_PHRASE_INTERVAL_SECONDS,
  );
  return phrases[step % phrases.length] ?? "";
}

/**
 * The line of a waiting chat: three pulsing dots and a sentence that changes
 * every 20 s, 28 px high and always one line.
 * @remarks
 * Pica's waiting state and the live answer of an agent in the chat page
 * share it, each with its own sentences. The dots stand still when the
 * person asked for reduced motion, and the change of the sentence is not
 * read out.
 */
export function ChatLivePhraseLine({
  phrases,
  elapsedSeconds,
}: {
  readonly phrases: readonly string[];
  readonly elapsedSeconds: number;
}): React.ReactElement {
  return (
    <p
      aria-live="off"
      className="flex h-7 min-w-0 items-center gap-2.5 overflow-hidden text-sm leading-5 whitespace-nowrap"
      data-live-phrase=""
    >
      <span aria-hidden="true" className="flex shrink-0 gap-1">
        {DOT_DELAYS.map((delay) => (
          <span
            key={delay}
            className={cn(
              "size-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none",
              delay,
            )}
          />
        ))}
      </span>
      <span className="min-w-0 truncate">
        {livePhraseAt(phrases, elapsedSeconds)}
      </span>
    </p>
  );
}

/** One quiet activity row for both API requests and server jobs, without intermediate output. */
export function ChatLiveStatus({
  startedAt,
  isOpen,
}: ChatLiveStatusProps): React.ReactElement {
  const { t } = useTranslation();
  const elapsed = useChatElapsed(startedAt, isOpen);
  return (
    <div
      className="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5"
      role="status"
      aria-label={t("chat.live.label")}
      aria-atomic="false"
    >
      <PicaMascot className="size-7" />
      <ChatLivePhraseLine
        phrases={PICA_PHRASES.map((phrase) => t(`chat.live.${phrase}`))}
        elapsedSeconds={elapsed}
      />
      <p
        role="timer"
        aria-live="off"
        aria-label={t("chat.live.elapsed")}
        className="col-start-2 text-xs leading-4 text-muted-foreground tabular-nums"
      >
        {formatChatElapsed(elapsed)}
      </p>
    </div>
  );
}
