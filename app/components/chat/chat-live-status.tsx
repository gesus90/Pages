import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { PicaMascot } from "./pica-mascot";
import { formatChatElapsed, useChatElapsed } from "./use-chat-elapsed";

const DOT_DELAYS = [
  "[animation-delay:0ms]",
  "[animation-delay:300ms]",
  "[animation-delay:600ms]",
] as const;
const PHRASES = ["phrase1", "phrase2", "phrase3", "phrase4", "phrase5"] as const;
const PHRASE_INTERVAL_SECONDS = 20;

interface ChatLiveStatusProps {
  readonly startedAt: number;
  readonly isOpen: boolean;
}

/** One quiet activity row for both API requests and server jobs, without intermediate output. */
export function ChatLiveStatus({
  startedAt,
  isOpen,
}: ChatLiveStatusProps): React.ReactElement {
  const { t } = useTranslation();
  const elapsed = useChatElapsed(startedAt, isOpen);
  const phrase =
    PHRASES[Math.floor(elapsed / PHRASE_INTERVAL_SECONDS) % PHRASES.length];
  return (
    <div
      className="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5"
      role="status"
      aria-label={t("chat.live.label")}
      aria-atomic="false"
    >
      <PicaMascot className="size-7" />
      <p className="flex h-7 min-w-0 items-center gap-2.5 text-sm leading-5">
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
        <span className="min-w-0 truncate">{t(`chat.live.${phrase}`)}</span>
      </p>
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
