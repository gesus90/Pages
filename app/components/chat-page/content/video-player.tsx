import { Download, Film, Maximize, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { downloadUrl, formatFileSize } from "./card-types";
import { CardAction, ContentCard } from "./content-card";
import { useAttachmentPreview } from "./use-attachment-preview";
import { formatMediaTime, useMediaPlayer } from "./use-media-player";

import type { ConversationAttachment } from "@/definition/ConversationContent";
import type { OpenedCard } from "./card-types";
import type { MediaPlayer } from "./use-media-player";

/** Steps of the progress bar from the start to the end. */
const PROGRESS_STEPS = 1000;

const CONTROL_CLASS =
  "inline-flex h-7 min-w-7 shrink-0 cursor-pointer items-center justify-center rounded-md px-1 text-xs font-medium text-foreground tabular-nums hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/** Whether the given element covers the screen, and the action that switches it. */
function useFullscreen(target: React.RefObject<HTMLElement | null>): {
  readonly isFullscreen: boolean;
  toggle(): void;
} {
  const [isFullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    function handleChange(): void {
      setFullscreen(
        target.current !== null &&
          document.fullscreenElement === target.current,
      );
    }
    document.addEventListener("fullscreenchange", handleChange);
    return () => document.removeEventListener("fullscreenchange", handleChange);
  }, [target]);
  function toggle(): void {
    const element = target.current;
    if (!element) return;
    const change =
      document.fullscreenElement === element
        ? document.exitFullscreen()
        : element.requestFullscreen();
    void change.catch(() => undefined);
  }
  return { isFullscreen, toggle };
}

interface VideoControlsProps {
  readonly player: MediaPlayer<HTMLVideoElement>;
  readonly onFullscreen: () => void;
}

/** The bar below a video: Start/Pause, the seekable progress, the time, the speed and the full screen. */
function VideoControls({
  player,
  onFullscreen,
}: VideoControlsProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const PlayIcon = player.isPlaying ? Pause : Play;
  const time = formatMediaTime(player.positionSeconds, player.durationSeconds);
  const speed = `${new Intl.NumberFormat(i18n.language).format(player.speed)}×`;
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-border bg-surface px-2 py-1.5">
      <button
        aria-label={
          player.isPlaying
            ? t("chatPage.cards.pause")
            : t("chatPage.cards.play")
        }
        className={CONTROL_CLASS}
        onClick={player.toggle}
        type="button"
      >
        <PlayIcon aria-hidden="true" className="size-4" />
      </button>
      <input
        aria-label={t("chatPage.cards.seek")}
        aria-valuetext={time}
        className="h-1 min-w-0 flex-1 cursor-pointer accent-primary disabled:cursor-default disabled:opacity-50"
        disabled={player.durationSeconds === null}
        max={PROGRESS_STEPS}
        min={0}
        onChange={(event) =>
          player.seek(Number(event.currentTarget.value) / PROGRESS_STEPS)
        }
        type="range"
        value={Math.round(player.share * PROGRESS_STEPS)}
      />
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {time}
      </span>
      <button
        aria-label={t("chatPage.cards.speed", { speed })}
        className={CONTROL_CLASS}
        onClick={player.nextSpeed}
        title={t("chatPage.cards.speed", { speed })}
        type="button"
      >
        {speed}
      </button>
      <button
        aria-label={t("chatPage.cards.videoFullscreen")}
        className={CONTROL_CLASS}
        onClick={onFullscreen}
        title={t("chatPage.cards.videoFullscreen")}
        type="button"
      >
        <Maximize aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}

interface VideoPlayerProps {
  readonly attachment: ConversationAttachment;
  /** Fills its container instead of keeping 16:9, for the split view and the full screen. */
  readonly isFilling?: boolean;
}

/**
 * The video player of the chat (PAGE-298) with its own controls in the
 * colors of the theme.
 *
 * @remarks
 * Until the person starts it, only the preview image is loaded
 * (`preload="none"`); the original streams from then on. Without a preview
 * image the stage names the file while the browser creates one.
 */
export function VideoPlayer({
  attachment,
  isFilling = false,
}: VideoPlayerProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const frame = useRef<HTMLDivElement | null>(null);
  const player = useMediaPlayer<HTMLVideoElement>();
  const fullscreen = useFullscreen(frame);
  const preview = useAttachmentPreview(attachment);
  const isLarge = isFilling || fullscreen.isFullscreen;
  const isUntouched = !player.isPlaying && player.positionSeconds === 0;
  return (
    <div
      ref={frame}
      className={cn(
        "flex flex-col bg-viewer-scrim",
        isLarge && "min-h-0 flex-1",
      )}
      data-video-player={attachment.id}
    >
      <div
        ref={preview.target}
        className={cn("relative", isLarge ? "min-h-0 flex-1" : "aspect-video")}
      >
        <video
          ref={player.media}
          className="absolute inset-0 size-full object-contain"
          playsInline
          poster={preview.previewUrl ?? undefined}
          preload="none"
          src={attachment.url}
          {...player.events}
        />
        <button
          aria-label={
            player.isPlaying
              ? t("chatPage.cards.pause")
              : t("chatPage.cards.play")
          }
          className="group absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-2 px-4 text-viewer-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
          onClick={player.toggle}
          type="button"
        >
          {player.isPlaying ? null : (
            <span className="flex size-14 items-center justify-center rounded-full bg-viewer-control ring-1 ring-viewer-edge group-hover:bg-viewer-control-hover">
              <Play aria-hidden="true" className="size-6" />
            </span>
          )}
          {preview.previewUrl === null && isUntouched ? (
            <span className="max-w-full truncate text-xs text-viewer-muted">
              {attachment.name} ·{" "}
              {formatFileSize(attachment.sizeBytes, i18n.language)}
              {preview.isPending
                ? ` · ${t("chatPage.cards.previewPending")}`
                : null}
            </span>
          ) : null}
        </button>
      </div>
      <VideoControls onFullscreen={fullscreen.toggle} player={player} />
    </div>
  );
}

interface VideoCardProps {
  /** The card of the video, as the split view opens it. */
  readonly card: OpenedCard & {
    readonly descriptor: { readonly kind: "video" };
  };
}

/** The card of a video of a message (PAGE-298): the player with Laden and Daneben. */
export function VideoCard({ card }: VideoCardProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const { attachment } = card.descriptor;
  return (
    <ContentCard
      actions={
        <CardAction
          href={downloadUrl(attachment)}
          icon={Download}
          label={t("chatPage.cards.download")}
        />
      }
      beside={card}
      cardKey={card.key}
      className="max-w-lg"
      defaultState="expanded"
      icon={Film}
      kindLabel={t("chatPage.cards.kind.video")}
      meta={formatFileSize(attachment.sizeBytes, i18n.language)}
      name={attachment.name}
    >
      <VideoPlayer attachment={attachment} />
    </ContentCard>
  );
}
