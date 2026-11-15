import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Pause, Play } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import {
  formatFixedMediaTime,
  nextMediaSpeed,
  useExclusivePlayback,
} from "./content/use-media-player";
import { speedLabel } from "./content/video-controls";
import {
  decodeAudio,
  formatVoiceDuration,
  VOICE_WAVE_BARS,
  wavePeaks,
} from "./voice-audio";

import type { VirtualVoice } from "@/definition/VirtualChat";

/**
 * The fixed columns of a voice message (PAGE-388), as the sound rows of
 * PAGE-384 have them: Start/Pause · sender and length · waveform (the rest)
 * · time `0:12 / 0:48` · speed. Every voice message has the same columns,
 * so several below each other line up exactly; on a narrow screen the
 * waveform moves into a second line.
 */
export const VOICE_ROW_COLUMNS =
  "grid-cols-[2.25rem_minmax(0,1fr)_7.5rem_3rem] sm:grid-cols-[2.25rem_13rem_minmax(0,1fr)_7.5rem_3rem]";

const FLAT_WAVE: readonly number[] = Array.from(
  { length: VOICE_WAVE_BARS },
  () => 0.3,
);

interface ChatPageVoiceProps {
  readonly voice: VirtualVoice;
  /** The recognized text; empty until it arrives. */
  readonly text: string;
  /** Who sent it: "Du" for the person, else the name of the participant. */
  readonly senderName: string;
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
function useVoicePlayer(
  durationMs: number,
  url: string,
): {
  readonly audio: React.RefObject<HTMLAudioElement | null>;
  readonly isPlaying: boolean;
  readonly positionMs: number;
  readonly speed: number;
  toggle(): void;
  seek(share: number): void;
  /** Steps to the next speed: 1× → 1,5× → 2× → 0,5×. */
  nextSpeed(): void;
  readonly events: Pick<
    React.AudioHTMLAttributes<HTMLAudioElement>,
    "onPlay" | "onPause" | "onEnded" | "onTimeUpdate"
  >;
} {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [speed, setSpeed] = useState(1);
  // Only one medium of the page plays at a time (PAGE-384).
  const playback = useExclusivePlayback(audio, `voice:${url}`);
  function toggle(): void {
    const element = audio.current;
    if (!element) return;
    if (!element.paused) {
      element.pause();
      return;
    }
    // A new load resets the speed of the element.
    element.playbackRate = speed;
    void element.play().catch(() => setPlaying(false));
  }
  function nextSpeed(): void {
    const next = nextMediaSpeed(speed);
    setSpeed(next);
    if (audio.current) audio.current.playbackRate = next;
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
    speed,
    toggle,
    seek,
    nextSpeed,
    events: {
      onPlay: () => {
        setPlaying(true);
        playback.claim();
      },
      onPause: () => {
        setPlaying(false);
        playback.release();
      },
      onEnded: () => {
        setPlaying(false);
        setPositionMs(0);
        playback.release();
      },
      onTimeUpdate: (event) =>
        setPositionMs(event.currentTarget.currentTime * 1000),
    },
  };
}

/** The bars of the waveform; the played part is full, the rest faint. Clicking seeks. */
export function VoiceWave({
  peaks,
  share,
  isOwn,
  label,
  onSeek,
  isRestNeutral = false,
}: {
  readonly peaks: readonly number[] | null;
  readonly share: number;
  readonly isOwn: boolean;
  readonly label: string;
  readonly onSeek: (share: number) => void;
  /** Draws the part not played yet in the neutral border color instead of a pale accent (PAGE-384). */
  readonly isRestNeutral?: boolean;
}): React.ReactElement {
  const bars = peaks ?? FLAT_WAVE;
  const played = Math.round(share * bars.length);
  const color = isOwn ? "bg-primary-foreground" : "bg-primary";
  const rest = isRestNeutral ? "bg-border" : cn(color, "opacity-40");
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
          className={cn("flex-1 rounded-full", index < played ? color : rest)}
          style={{ height: `${Math.max(12, peak * 100)}%` }}
        />
      ))}
    </button>
  );
}

/**
 * The recognized text below the row (PAGE-388): "Wird erkannt …" until it
 * arrives, a note when the recognition failed, and else the text, collapsed
 * by default behind "Text anzeigen".
 */
function VoiceTranscript({
  state,
  text,
}: {
  readonly state: VirtualVoice["transcriptionState"];
  readonly text: string;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const [isShown, setShown] = useState(false);
  if (state !== "done")
    return (
      <p
        className="border-t border-border px-3 py-2 text-[13px] text-muted-foreground italic"
        role={state === "pending" ? "status" : undefined}
      >
        {state === "pending"
          ? t("chatPage.voice.transcribing")
          : t("chatPage.voice.failed")}
      </p>
    );
  if (text === "") return null;
  const ToggleIcon = isShown ? ChevronUp : ChevronDown;
  return (
    <div
      className="border-t border-border px-3 py-1.5"
      data-voice-transcript=""
    >
      <button
        aria-expanded={isShown}
        className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs font-medium text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        onClick={() => setShown((shown) => !shown)}
        type="button"
      >
        <ToggleIcon aria-hidden="true" className="size-3.5" />
        {isShown ? t("chatPage.voice.hideText") : t("chatPage.voice.showText")}
      </button>
      {isShown ? (
        <p className="px-1.5 pt-1 pb-1.5 text-[15px] whitespace-pre-wrap">
          {text}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A voice message (PAGE-278, PAGE-277, PAGE-388) as one row of the sound
 * grid: the round Start/Pause in the accent color, sender and length, the
 * waveform with the played part, the time as `0:12 / 0:48` and the speed,
 * each in its fixed column, and below it the recognized text; the audio
 * stays playable whatever the recognition did.
 *
 * @remarks
 * The row needs no download: the person sent the recording or hears it here.
 */
export function ChatPageVoice({
  voice,
  text,
  senderName,
}: ChatPageVoiceProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const peaks = useVoicePeaks(voice.url);
  const player = useVoicePlayer(voice.durationMs, voice.url);
  const share = Math.min(1, player.positionMs / Math.max(1, voice.durationMs));
  const PlayIcon = player.isPlaying ? Pause : Play;
  const speed = speedLabel(player.speed, i18n.language);
  const length = t("chatPage.voice.label", {
    duration: formatVoiceDuration(voice.durationMs),
  });
  return (
    <section
      aria-label={length}
      className="w-full max-w-full overflow-hidden rounded-xl border border-border bg-surface text-left text-foreground shadow-xs sm:w-[42rem]"
      data-voice-row=""
    >
      <div
        className={cn(
          "grid items-center gap-x-3 gap-y-1.5 px-3 py-2.5",
          VOICE_ROW_COLUMNS,
        )}
        data-voice-grid=""
      >
        <button
          aria-label={
            player.isPlaying
              ? t("chatPage.voice.pause")
              : t("chatPage.voice.player")
          }
          className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          onClick={player.toggle}
          type="button"
        >
          <PlayIcon aria-hidden="true" className="size-4" />
        </button>
        <p className="flex min-w-0 flex-col leading-tight" data-voice-sender="">
          <span className="truncate text-[13px] font-semibold">
            {senderName}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {length}
          </span>
        </p>
        <div
          className="order-last col-span-full flex min-w-0 sm:order-none sm:col-span-1"
          data-voice-wave-column=""
        >
          <VoiceWave
            isOwn={false}
            isRestNeutral
            label={t("chatPage.voice.seek")}
            onSeek={player.seek}
            peaks={peaks}
            share={share}
          />
        </div>
        <span
          className="text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums"
          data-voice-time=""
        >
          {formatFixedMediaTime(
            player.positionMs / 1000,
            voice.durationMs / 1000,
          )}
        </span>
        <button
          aria-label={t("chatPage.cards.speed", { speed })}
          className="h-7 cursor-pointer rounded-md text-center text-xs font-medium text-muted-foreground tabular-nums hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          onClick={player.nextSpeed}
          title={t("chatPage.cards.speed", { speed })}
          type="button"
        >
          {speed}
        </button>
      </div>
      <audio
        ref={player.audio}
        className="hidden"
        data-voice-audio=""
        preload="metadata"
        src={voice.url}
        {...player.events}
      />
      <VoiceTranscript state={voice.transcriptionState} text={text} />
    </section>
  );
}
