import { useEffect, useRef, useState } from "react";
import { Mic, Pause, Play } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import {
  decodeAudio,
  formatVoiceDuration,
  VOICE_WAVE_BARS,
  wavePeaks,
} from "./voice-audio";

import type { VirtualVoice } from "@/definition/VirtualChat";

const FLAT_WAVE: readonly number[] = Array.from(
  { length: VOICE_WAVE_BARS },
  () => 0.3,
);

interface ChatPageVoiceProps {
  readonly voice: VirtualVoice;
  /** The recognized text; empty until it arrives. */
  readonly text: string;
  /** Lighter text for the person's own primary bubble. */
  readonly isOwn: boolean;
}

/** The waveform of the audio, read once in the browser; flat until then or when it cannot be read. */
function useVoicePeaks(url: string): readonly number[] | null {
  const [peaks, setPeaks] = useState<readonly number[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function read(): Promise<void> {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return;
      const audio = await decodeAudio(await response.arrayBuffer());
      if (!controller.signal.aborted)
        setPeaks(wavePeaks(audio.getChannelData(0)));
    }
    void read().catch(() => undefined);
    return () => controller.abort();
  }, [url]);
  return peaks;
}

/** Playing, the position and the seeking of one voice message. */
function useVoicePlayer(durationMs: number): {
  readonly audio: React.RefObject<HTMLAudioElement | null>;
  readonly isPlaying: boolean;
  readonly positionMs: number;
  toggle(): void;
  seek(share: number): void;
  readonly events: Pick<
    React.AudioHTMLAttributes<HTMLAudioElement>,
    "onPlay" | "onPause" | "onEnded" | "onTimeUpdate"
  >;
} {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  function toggle(): void {
    const element = audio.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => setPlaying(false));
    else element.pause();
  }
  function seek(share: number): void {
    const element = audio.current;
    if (!element) return;
    element.currentTime = (share * durationMs) / 1000;
    setPositionMs(share * durationMs);
  }
  return {
    audio,
    isPlaying,
    positionMs,
    toggle,
    seek,
    events: {
      onPlay: () => setPlaying(true),
      onPause: () => setPlaying(false),
      onEnded: () => {
        setPlaying(false);
        setPositionMs(0);
      },
      onTimeUpdate: (event) =>
        setPositionMs(event.currentTarget.currentTime * 1000),
    },
  };
}

/** The bars of the waveform; the played part is full, the rest faint. Clicking seeks. */
function VoiceWave({
  peaks,
  share,
  isOwn,
  label,
  onSeek,
}: {
  readonly peaks: readonly number[] | null;
  readonly share: number;
  readonly isOwn: boolean;
  readonly label: string;
  readonly onSeek: (share: number) => void;
}): React.ReactElement {
  const bars = peaks ?? FLAT_WAVE;
  const played = Math.round(share * bars.length);
  const color = isOwn ? "bg-primary-foreground" : "bg-primary";
  function handleClick(event: React.MouseEvent<HTMLButtonElement>): void {
    const box = event.currentTarget.getBoundingClientRect();
    onSeek(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)));
  }
  return (
    <button
      aria-label={label}
      className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-px"
      data-voice-wave={peaks ? "decoded" : "pending"}
      onClick={handleClick}
      type="button"
    >
      {bars.map((peak, index) => (
        <span
          key={index}
          aria-hidden="true"
          className={cn(
            "flex-1 rounded-full",
            color,
            index < played ? undefined : "opacity-40",
          )}
          style={{ height: `${Math.max(12, peak * 100)}%` }}
        />
      ))}
    </button>
  );
}

/**
 * A voice message in a bubble (PAGE-278, PAGE-277): play and pause, the
 * waveform with the played part, the position and length, and the
 * recognized text below it, "Wird erkannt …" until it arrives, or a note
 * when the recognition failed; the audio stays playable either way.
 */
export function ChatPageVoice({
  voice,
  text,
  isOwn,
}: ChatPageVoiceProps): React.ReactElement {
  const { t } = useTranslation();
  const peaks = useVoicePeaks(voice.url);
  const player = useVoicePlayer(voice.durationMs);
  const muted = isOwn ? "text-primary-foreground/80" : "text-muted-foreground";
  const status: Readonly<Record<VirtualVoice["transcriptionState"], string>> = {
    pending: t("chatPage.voice.transcribing"),
    failed: t("chatPage.voice.failed"),
    done: text,
  };
  const share = Math.min(1, player.positionMs / Math.max(1, voice.durationMs));
  const PlayIcon = player.isPlaying ? Pause : Play;
  return (
    <div className="flex min-w-64 flex-col gap-1.5">
      <p className={cn("flex items-center gap-1.5 text-xs", muted)}>
        <Mic aria-hidden="true" className="size-3.5" />
        {t("chatPage.voice.label", {
          duration: formatVoiceDuration(voice.durationMs),
        })}
      </p>
      <div className="flex items-center gap-2">
        <button
          aria-label={
            player.isPlaying
              ? t("chatPage.voice.pause")
              : t("chatPage.voice.player")
          }
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full",
            isOwn
              ? "bg-primary-foreground text-primary"
              : "bg-primary text-primary-foreground",
          )}
          onClick={player.toggle}
          type="button"
        >
          <PlayIcon aria-hidden="true" className="size-4" />
        </button>
        <VoiceWave
          peaks={peaks}
          share={share}
          isOwn={isOwn}
          label={t("chatPage.voice.seek")}
          onSeek={player.seek}
        />
        <span className={cn("shrink-0 text-xs tabular-nums", muted)}>
          {formatVoiceDuration(
            player.isPlaying || player.positionMs > 0
              ? player.positionMs
              : voice.durationMs,
          )}
        </span>
      </div>
      <audio
        ref={player.audio}
        className="hidden"
        data-voice-audio=""
        preload="metadata"
        src={voice.url}
        {...player.events}
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
