import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { PicaMascot } from "./pica-mascot";
import { formatChatElapsed, useChatElapsed } from "./use-chat-elapsed";

const DOT_DELAYS = [
  "[animation-delay:0ms]",
  "[animation-delay:300ms]",
  "[animation-delay:600ms]",
] as const;
const PHRASES = ["browsing", "working", "moment"] as const;
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
      className="flex items-start gap-2"
      role="status"
      aria-label={t("chat.live.label")}
      aria-atomic="false"
    >
      <PicaMascot className="mt-1 size-7" />
      <div className="min-w-0 py-1">
        <p className="flex items-start gap-2.5 text-sm">
          <span aria-hidden="true" className="mt-1.5 flex shrink-0 gap-1">
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
          <span>{t(`chat.live.${phrase}`)}</span>
        </p>
        <p
          role="timer"
          aria-live="off"
          aria-label={t("chat.live.elapsed")}
          className="mt-1 text-xs text-muted-foreground tabular-nums"
        >
          {formatChatElapsed(elapsed)}
        </p>
      </div>
    </div>
  );
}
