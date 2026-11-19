import { Mic, MicOff, PhoneOff } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import type { CallAudioState } from "./call-audio-session";

const FOCUS_RING =
  "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none";

/** The audio of a running call with a person, which the bar shows and steers. */
export interface ChatCallBarAudio {
  /** The audio of this call; `null` until its connection starts. */
  readonly state: CallAudioState | null;
  readonly onToggleMute: () => void;
  /** Opens "Audio-Einstellungen", where a microphone for the next call is chosen. */
  readonly onOpenSettings: () => void;
}

type MicrophoneProblem = "lost" | "blocked" | "none" | "unavailable";

/** The microphone state that needs the person's attention, or `null` while it works. */
function problemOf(state: CallAudioState | null): MicrophoneProblem | null {
  const microphone = state?.microphone;
  if (microphone === undefined || microphone === "on" || microphone === "muted")
    return null;
  return microphone;
}

function statusLine(
  state: CallAudioState | null,
  t: (key: string) => string,
): string {
  if (state?.connection === "failed") return t("chatCall.audio.bar.failed");
  if (state?.connection !== "connected")
    return t("chatCall.audio.bar.connecting");
  return state.microphone === "muted"
    ? t("chatCall.audio.bar.microphoneOff")
    : t("chatCall.audio.bar.microphoneOn");
}

function MuteControls({
  isMuted,
  onToggleMute,
}: {
  readonly isMuted: boolean;
  readonly onToggleMute: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const Icon = isMuted ? MicOff : Mic;
  return (
    <>
      {isMuted ? (
        <span className="inline-flex h-6 shrink-0 items-center rounded-[7px] border border-destructive px-2 text-[11px] font-semibold text-destructive">
          {t("chatCall.audio.bar.muted")}
        </span>
      ) : null}
      <button
        type="button"
        aria-pressed={isMuted}
        aria-label={t(
          isMuted ? "chatCall.audio.bar.unmute" : "chatCall.audio.bar.mute",
        )}
        title={t(
          isMuted ? "chatCall.audio.bar.unmute" : "chatCall.audio.bar.mute",
        )}
        onClick={onToggleMute}
        className={cn(
          "inline-flex size-9 shrink-0 items-center justify-center rounded-xl border",
          isMuted
            ? "border-destructive bg-destructive/14 text-destructive"
            : "border-border bg-surface text-foreground hover:bg-muted",
          FOCUS_RING,
        )}
      >
        <Icon aria-hidden="true" className="size-4" />
      </button>
    </>
  );
}

/**
 * The bar of a running call with a person, in the three states of the microphone.
 * @remarks
 * "Mikrofon an", "Stumm" (shown by button, mark and text, never by color
 * alone) and "Gerät verloren" with the way to the audio settings. The bar is
 * one status message that changes only when the state changes. The path of the
 * audio, direct or relay, is named in `data-call-route` for the check of a
 * connection.
 */
export function AudioCallBar({
  name,
  onEnd,
  audio,
}: {
  readonly name: string;
  readonly onEnd: () => void;
  readonly audio: ChatCallBarAudio;
}): React.ReactElement {
  const { t } = useTranslation();
  const problem = problemOf(audio.state);
  const isMuted = audio.state?.microphone === "muted";
  return (
    <div
      role="status"
      data-call-route={audio.state?.route ?? undefined}
      className={cn(
        "-mt-1 flex h-14 shrink-0 items-center gap-3 rounded-2xl border pr-3 pl-4",
        problem === null
          ? "border-primary bg-primary-subtle"
          : "border-warning bg-[color-mix(in_srgb,var(--color-warning)_12%,var(--color-surface))]",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2.5 shrink-0 rounded-full",
          problem === null
            ? "animate-pulse bg-primary ring-4 ring-primary/25 motion-reduce:animate-none"
            : "bg-warning ring-4 ring-warning/25",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm leading-5 font-bold">
          {problem === null
            ? t("chatCall.active", { name })
            : t("chatCall.audio.bar.unavailableTitle")}
        </p>
        <p className="truncate text-xs leading-4 text-foreground/75">
          {problem === null
            ? statusLine(audio.state, t)
            : t(`chatCall.audio.bar.${problem}`)}
        </p>
      </div>
      {problem === null ? (
        <MuteControls isMuted={isMuted} onToggleMute={audio.onToggleMute} />
      ) : (
        <button
          type="button"
          onClick={audio.onOpenSettings}
          className={cn(
            "inline-flex h-9 shrink-0 items-center rounded-xl bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground hover:bg-primary-hover",
            FOCUS_RING,
          )}
        >
          {t("chatCall.audio.bar.openSettings")}
        </button>
      )}
      <button
        type="button"
        onClick={onEnd}
        className={cn(
          "inline-flex h-9 shrink-0 items-center gap-2 rounded-xl bg-destructive px-3.5 text-[13px] font-semibold text-background",
          FOCUS_RING,
        )}
      >
        <PhoneOff aria-hidden="true" className="size-4" />
        {t("chatCall.hangUp")}
      </button>
    </div>
  );
}
