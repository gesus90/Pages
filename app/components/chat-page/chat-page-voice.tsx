import { Mic } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import type { VirtualVoice } from "@/definition/VirtualChat";

/** `m:ss` of a duration in milliseconds. */
function formatDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

interface ChatPageVoiceProps {
  readonly voice: VirtualVoice;
  /** The recognized text; empty until it arrives. */
  readonly text: string;
  /** Lighter text for the person's own primary bubble. */
  readonly isOwn: boolean;
}

/**
 * A voice message in a bubble (PAGE-278): the player with its length, and the
 * recognized text below it, "Wird erkannt …" until it arrives, or a note when
 * the recognition failed; the audio stays playable either way.
 */
export function ChatPageVoice({
  voice,
  text,
  isOwn,
}: ChatPageVoiceProps): React.ReactElement {
  const { t } = useTranslation();
  const muted = isOwn ? "text-primary-foreground/80" : "text-muted-foreground";
  const status: Readonly<Record<VirtualVoice["transcriptionState"], string>> = {
    pending: t("chatPage.voice.transcribing"),
    failed: t("chatPage.voice.failed"),
    done: text,
  };
  return (
    <div className="flex min-w-60 flex-col gap-1.5">
      <p className={cn("flex items-center gap-1.5 text-xs", muted)}>
        <Mic aria-hidden="true" className="size-3.5" />
        {t("chatPage.voice.label", {
          duration: formatDuration(voice.durationMs),
        })}
      </p>
      <audio
        aria-label={t("chatPage.voice.player")}
        className="h-9 w-full"
        controls
        preload="metadata"
        src={voice.url}
      />
      <p
        className={cn(
          "text-[15px] whitespace-pre-wrap",
          voice.transcriptionState === "done" ? undefined : cn("italic", muted),
        )}
        role={voice.transcriptionState === "pending" ? "status" : undefined}
      >
        {status[voice.transcriptionState]}
      </p>
    </div>
  );
}
