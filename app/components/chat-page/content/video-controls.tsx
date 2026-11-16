import {
  Captions,
  Maximize2,
  Pause,
  PictureInPicture2,
  Play,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { formatSeconds } from "./use-media-player";

import type { CardTone } from "./content-card";
import type { MediaPlayer } from "./use-media-player";

/** Steps of the progress bar from the start to the end. */
const PROGRESS_STEPS = 1000;

const CONTROL_CLASSES: Readonly<Record<CardTone, string>> = {
  light: "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
  dark: "text-viewer-foreground hover:bg-viewer-control-hover",
};

const CONTROL_BASE =
  "inline-flex h-7 min-w-7 shrink-0 cursor-pointer items-center justify-center rounded-md px-1 text-xs font-medium tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/** The speed of a player as its button shows it, such as `1,5×`. */
export function speedLabel(speed: number, language: string): string {
  return `${new Intl.NumberFormat(language).format(speed)}×`;
}

interface ControlButtonProps {
  readonly label: string;
  readonly tone: CardTone;
  readonly onClick: () => void;
  readonly isActive?: boolean;
  readonly children: React.ReactNode;
}

/** One quiet button of the bar; an active one lights in the accent color. */
function ControlButton({
  label,
  tone,
  onClick,
  isActive = false,
  children,
}: ControlButtonProps): React.ReactElement {
  return (
    <button
      aria-label={label}
      aria-pressed={isActive ? true : undefined}
      className={cn(
        CONTROL_BASE,
        CONTROL_CLASSES[tone],
        isActive && "bg-primary-subtle text-primary hover:bg-primary-subtle",
      )}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

interface MediaProgressProps {
  readonly player: Pick<
    MediaPlayer<HTMLMediaElement>,
    "share" | "bufferedShare" | "durationSeconds" | "positionSeconds" | "seek"
  >;
  readonly tone: CardTone;
}

/**
 * The seekable progress of a video: the loaded part behind the
 * played part in the accent color, with a slider on top.
 */
export function MediaProgress({
  player,
  tone,
}: MediaProgressProps): React.ReactElement {
  const { t } = useTranslation();
  const isDark = tone === "dark";
  return (
    <div
      className="relative flex h-4 min-w-0 flex-1 items-center"
      data-media-progress=""
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-x-0 h-1 overflow-hidden rounded-full",
          isDark ? "bg-viewer-control" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "absolute inset-y-0 left-0",
            isDark ? "bg-viewer-edge" : "bg-border",
          )}
          data-media-buffered={player.bufferedShare.toFixed(3)}
          style={{ width: `${String(player.bufferedShare * 100)}%` }}
        />
        <span
          className="absolute inset-y-0 left-0 bg-primary"
          style={{ width: `${String(player.share * 100)}%` }}
        />
      </span>
      <input
        aria-label={t("chatPage.cards.seek")}
        aria-valuetext={formatSeconds(player.positionSeconds)}
        className="relative h-4 w-full cursor-pointer appearance-none bg-transparent accent-primary disabled:cursor-default [&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
        disabled={player.durationSeconds === null}
        max={PROGRESS_STEPS}
        min={0}
        onChange={(event) =>
          player.seek(Number(event.currentTarget.value) / PROGRESS_STEPS)
        }
        type="range"
        value={Math.round(player.share * PROGRESS_STEPS)}
      />
    </div>
  );
}

/** What only the full screen offers in the bar. */
export interface VideoControlExtras {
  /** Switches the subtitles; only when the video has some. */
  readonly onCaptions?: () => void;
  readonly isCaptionsOn?: boolean;
  /** Picture in picture; only where the browser offers it. */
  readonly onPictureInPicture?: () => void;
}

interface VideoControlBarProps {
  readonly player: MediaPlayer<HTMLVideoElement>;
  readonly tone: CardTone;
  /** "Vollbild"; left out where the bar sits in the full screen already. */
  readonly onFullscreen?: () => void;
  readonly extras?: VideoControlExtras;
  readonly className?: string;
}

/**
 * The bar of a started video: Start/Pause in the accent color,
 * the time, the progress with the loaded part, the length, the speed, the
 * sound and "Vollbild"; in the full screen also subtitles and picture in
 * picture. Only Start/Pause and the progress take the accent color.
 */
export function VideoControlBar({
  player,
  tone,
  onFullscreen,
  extras,
  className,
}: VideoControlBarProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const PlayIcon = player.isPlaying ? Pause : Play;
  const SoundIcon = player.isMuted ? VolumeX : Volume2;
  const speed = speedLabel(player.speed, i18n.language);
  const timeClass = cn(
    "shrink-0 text-xs tabular-nums",
    tone === "dark" ? "text-viewer-foreground" : "text-muted-foreground",
  );
  return (
    <div
      className={cn("flex items-center gap-2 px-2 py-1.5", className)}
      data-video-controls={tone}
    >
      <button
        aria-label={
          player.isPlaying
            ? t("chatPage.cards.pause")
            : t("chatPage.cards.play")
        }
        className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        onClick={player.toggle}
        type="button"
      >
        <PlayIcon aria-hidden="true" className="size-4" />
      </button>
      <span className={timeClass}>{formatSeconds(player.positionSeconds)}</span>
      <MediaProgress player={player} tone={tone} />
      <span className={timeClass}>
        {player.durationSeconds === null
          ? "–:––"
          : formatSeconds(player.durationSeconds)}
      </span>
      <ControlButton
        label={t("chatPage.cards.speed", { speed })}
        onClick={player.nextSpeed}
        tone={tone}
      >
        <span className="w-8 text-center">{speed}</span>
      </ControlButton>
      {extras?.onCaptions ? (
        <ControlButton
          isActive={extras.isCaptionsOn === true}
          label={t("chatPage.video.captions")}
          onClick={extras.onCaptions}
          tone={tone}
        >
          <Captions aria-hidden="true" className="size-4" />
        </ControlButton>
      ) : null}
      <ControlButton
        label={
          player.isMuted ? t("chatPage.video.unmute") : t("chatPage.video.mute")
        }
        onClick={player.toggleMute}
        tone={tone}
      >
        <SoundIcon aria-hidden="true" className="size-4" />
      </ControlButton>
      {extras?.onPictureInPicture ? (
        <ControlButton
          label={t("chatPage.video.pictureInPicture")}
          onClick={extras.onPictureInPicture}
          tone={tone}
        >
          <PictureInPicture2 aria-hidden="true" className="size-4" />
        </ControlButton>
      ) : null}
      {onFullscreen ? (
        <ControlButton
          label={t("chatPage.cards.fullscreen")}
          onClick={onFullscreen}
          tone={tone}
        >
          <Maximize2 aria-hidden="true" className="size-4" />
        </ControlButton>
      ) : null}
    </div>
  );
}
