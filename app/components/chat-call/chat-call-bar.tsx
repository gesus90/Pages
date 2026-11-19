import { PhoneOff } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { AudioCallBar } from "./chat-call-audio-bar";

import type { ChatCallBarAudio } from "./chat-call-audio-bar";

/** Whether the person waits for the answer or the call runs. */
export type ChatCallPhase = "waiting" | "active";

interface ChatCallBarProps {
  readonly phase: ChatCallPhase;
  /** The name of the other side of the direct chat. */
  readonly name: string;
  /** "Abbrechen" while waiting, "Auflegen" once the call runs. */
  readonly onEnd: () => void;
  /** The audio of a running call with a person or an agent. */
  readonly audio?: ChatCallBarAudio;
}

const ACTION_BUTTON =
  "inline-flex h-9 shrink-0 items-center gap-2 rounded-xl text-[13px] font-semibold focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none";

function EndButton({
  phase,
  onEnd,
}: Pick<ChatCallBarProps, "phase" | "onEnd">): React.ReactElement {
  const { t } = useTranslation();
  if (phase === "waiting")
    return (
      <button
        type="button"
        className={cn(
          ACTION_BUTTON,
          "border border-border bg-surface px-3.5 text-foreground hover:bg-muted",
        )}
        onClick={onEnd}
      >
        {t("chatCall.cancel")}
      </button>
    );
  return (
    <button
      type="button"
      className={cn(ACTION_BUTTON, "bg-destructive px-3.5 text-background")}
      onClick={onEnd}
    >
      <PhoneOff aria-hidden="true" className="size-4" />
      {t("chatCall.hangUp")}
    </button>
  );
}

/**
 * The call under the head of the direct chat.
 * @remarks
 * It is a status message of 56 px. Waiting for a person and a running call
 * differ in surface, dot and action. A running call, with a person or an
 * agent, shows the state of the microphone, the mute button and, when the
 * microphone is missing, the way to the audio settings; "Auflegen" is always
 * there.
 */
export function ChatCallBar({
  phase,
  name,
  onEnd,
  audio,
}: ChatCallBarProps): React.ReactElement {
  const { t } = useTranslation();
  if (phase === "active")
    return audio === undefined ? (
      <></>
    ) : (
      <AudioCallBar name={name} onEnd={onEnd} audio={audio} />
    );
  return (
    <div
      role="status"
      className="-mt-1 flex h-14 shrink-0 items-center gap-3 rounded-2xl border border-border bg-surface pr-3 pl-4"
    >
      <span
        aria-hidden="true"
        className="size-2.5 shrink-0 rounded-full bg-muted-foreground"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm leading-5 font-bold">
          {t("chatCall.waitingTitle", { name })}
        </p>
        <p className="truncate text-xs leading-4 text-muted-foreground">
          {t("chatCall.waiting")}
        </p>
      </div>
      <EndButton phase={phase} onEnd={onEnd} />
    </div>
  );
}
