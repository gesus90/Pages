import { Mic, MicOff, PhoneOff } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import type { AgentCallFailure } from "@/definition/AgentCall";
import type {
  AgentCallActivity,
  AgentCallInterruption,
  AgentCallLatency,
  AgentCallPaths,
} from "./agent-call/agent-call-session";
import type { PlaybackGap } from "./agent-call/agent-stream-player";
import type { CallAudioState } from "./call-audio-session";

const FOCUS_RING =
  "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none";

/** What the bar shows of a call with an agent beside the microphone. */
export interface ChatCallBarAgent {
  readonly activity: AgentCallActivity;
  /** The step that failed last; `null` while the call goes well. */
  readonly failure: AgentCallFailure | null;
  /** The call could not start, so there is nothing to mute. */
  readonly isFailedToStart: boolean;
  /** The saved voice is not offered by the speech model. */
  readonly isVoiceMissing: boolean;
  readonly latencies: readonly AgentCallLatency[];
  /** How recognition and voice run; `null` until the call has started. */
  readonly paths: AgentCallPaths | null;
  /** The preliminary transcript of what the person is saying. */
  readonly partial: string | null;
  readonly gaps: readonly PlaybackGap[];
  readonly interruptions: readonly AgentCallInterruption[];
}

/** The audio of a running call, which the bar shows and steers. */
export interface ChatCallBarAudio {
  /** The audio of this call; `null` until its connection starts. */
  readonly state: CallAudioState | null;
  readonly onToggleMute: () => void;
  /** Opens "Audio-Einstellungen", where a microphone for the next call is chosen. */
  readonly onOpenSettings: () => void;
  /** Present for a call with an agent. */
  readonly agent?: ChatCallBarAgent;
}

type MicrophoneProblem = "lost" | "blocked" | "none" | "unavailable";

/** The microphone state that needs the person's attention, or `null` while it works. */
function problemOf(state: CallAudioState | null): MicrophoneProblem | null {
  const microphone = state?.microphone;
  if (microphone === undefined || microphone === "on" || microphone === "muted")
    return null;
  return microphone;
}

function agentLine(
  agent: ChatCallBarAgent,
  isMuted: boolean,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (agent.failure !== null)
    return t(`chatCall.agent.failure.${agent.failure}`);
  if (isMuted) return t("chatCall.audio.bar.microphoneOff");
  if (agent.partial !== null && agent.activity !== "speaking")
    return t("chatCall.agent.partial", { text: agent.partial });
  if (agent.isVoiceMissing && agent.activity === "listening")
    return t("chatCall.agent.voiceMissing");
  return t(`chatCall.agent.activity.${agent.activity}`);
}

function statusLine(
  audio: ChatCallBarAudio,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const { state, agent } = audio;
  if (agent !== undefined)
    return agentLine(agent, state?.microphone === "muted", t);
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

/** Names a step that waits for the whole utterance or phrase, so the person knows why the voice is slower. */
function BufferedMark({
  paths,
}: {
  readonly paths: AgentCallPaths | null;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (paths === null) return null;
  const isRecognitionBuffered = paths.recognition === "buffered";
  const isSynthesisBuffered = paths.synthesis === "buffered";
  if (!isRecognitionBuffered && !isSynthesisBuffered) return null;
  let key = "chatCall.agent.buffered.both";
  if (!isSynthesisBuffered) key = "chatCall.agent.buffered.recognition";
  if (!isRecognitionBuffered) key = "chatCall.agent.buffered.synthesis";
  return (
    <span
      title={t(key)}
      className="inline-flex h-6 shrink-0 items-center rounded-[7px] border border-border px-2 text-[11px] font-semibold text-muted-foreground"
    >
      {t("chatCall.agent.buffered.label")}
    </span>
  );
}

type BarProblem = MicrophoneProblem | "agent";

/** What needs the person's attention: a call that could not start, or the microphone. */
function barProblemOf(audio: ChatCallBarAudio): BarProblem | null {
  if (audio.agent?.isFailedToStart === true) return "agent";
  return problemOf(audio.state);
}

function BarText({
  name,
  audio,
  problem,
}: {
  readonly name: string;
  readonly audio: ChatCallBarAudio;
  readonly problem: BarProblem | null;
}): React.ReactElement {
  const { t } = useTranslation();
  let title = t("chatCall.active", { name });
  let line = statusLine(audio, t);
  if (problem === "agent") {
    title = t("chatCall.agent.failedTitle");
  } else if (problem !== null) {
    title = t("chatCall.audio.bar.unavailableTitle");
    line = t(`chatCall.audio.bar.${problem}`);
  }
  return (
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm leading-5 font-bold">{title}</p>
      <p className="truncate text-xs leading-4 text-foreground/75">{line}</p>
    </div>
  );
}

/** A JSON data attribute of the bar; absent while the list is empty. */
function jsonAttribute(
  items: readonly unknown[] | undefined,
): string | undefined {
  return items === undefined || items.length === 0
    ? undefined
    : JSON.stringify(items);
}

function BarControls({
  audio,
  problem,
}: {
  readonly audio: ChatCallBarAudio;
  readonly problem: BarProblem | null;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (problem === "agent") return null;
  if (problem === null)
    return (
      <MuteControls
        isMuted={audio.state?.microphone === "muted"}
        onToggleMute={audio.onToggleMute}
      />
    );
  return (
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
  );
}

/**
 * The bar of a running call, in the states of the microphone.
 * @remarks
 * "Mikrofon an", "Stumm" (shown by button, mark and text, never by color
 * alone) and "Gerät verloren" with the way to the audio settings. A call with
 * an agent names what the agent does, listening, thinking or speaking, and
 * the step that failed; a call that could not start offers only to hang up.
 * The bar is one status message that changes only when the state changes. The
 * path of the audio, direct or relay, is named in `data-call-route` and the
 * measured times of each answer in `data-call-latency`, for the check of a
 * call. With an agent the bar shows the preliminary transcript while the
 * person speaks and marks a buffered step; `data-call-paths`,
 * `data-call-gaps` and `data-call-interruptions` carry the paths, the silent
 * stretches inside answers and the time each interruption took.
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
  const problem = barProblemOf(audio);
  const agent = audio.agent;
  return (
    <div
      role="status"
      data-call-route={audio.state?.route ?? undefined}
      data-call-latency={jsonAttribute(agent?.latencies)}
      data-call-paths={agent?.paths ? JSON.stringify(agent.paths) : undefined}
      data-call-gaps={jsonAttribute(agent?.gaps)}
      data-call-interruptions={jsonAttribute(agent?.interruptions)}
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
      <BarText name={name} audio={audio} problem={problem} />
      {problem === null && agent !== undefined ? (
        <BufferedMark paths={agent.paths} />
      ) : null}
      <BarControls audio={audio} problem={problem} />
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
