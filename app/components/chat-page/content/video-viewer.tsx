import {
  ChevronLeft,
  ChevronRight,
  Film,
  MessageSquareText,
  PanelRight,
  Play,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { downloadUrl } from "./card-types";
import { messageElement } from "./chat-image-viewer";
import { useChatContent } from "./chat-content-context";
import {
  CardAction,
  CardActionDivider,
  CardDownloadAction,
  CardHead,
  subtitleOf,
} from "./content-card";
import { retentionLabel } from "./file-retention";
import { useMediaFacts } from "./media-facts";
import { useAttachmentPreview } from "./use-attachment-preview";
import { useChatVideos, videoCardOf, videoEntryOf } from "./use-chat-videos";
import { useNow } from "./use-now";
import { useIdleControls, useVideoViewerKeys } from "./use-video-viewer-keys";
import { VideoControlBar } from "./video-controls";
import { useVideoPlayer, videoMeta } from "./video-player";

import type { ConversationImage } from "@/definition/ConversationContent";
import type { VideoControlExtras } from "./video-controls";
import type { VideoOpenedCard } from "./video-panel";

/** Switches the full screen of the browser for the stage. */
function toggleBrowserFullscreen(stage: HTMLElement | null): void {
  if (!stage || typeof document.exitFullscreen !== "function") return;
  const change =
    document.fullscreenElement === stage
      ? document.exitFullscreen()
      : stage.requestFullscreen();
  void change.catch(() => undefined);
}

/** Subtitles and picture in picture, where the video and the browser offer them. */
function useViewerExtras(
  video: React.RefObject<HTMLVideoElement | null>,
  isReady: boolean,
): VideoControlExtras {
  const [hasCaptions, setHasCaptions] = useState(false);
  const [isCaptionsOn, setCaptionsOn] = useState(false);
  useEffect(() => {
    setHasCaptions((video.current?.textTracks.length ?? 0) > 0);
  }, [video, isReady]);
  function toggleCaptions(): void {
    const tracks = video.current?.textTracks;
    if (!tracks) return;
    const next = !isCaptionsOn;
    for (const track of tracks) track.mode = next ? "showing" : "hidden";
    setCaptionsOn(next);
  }
  function pictureInPicture(): void {
    const element = video.current;
    if (!element) return;
    const change =
      document.pictureInPictureElement === element
        ? document.exitPictureInPicture()
        : element.requestPictureInPicture();
    void change.catch(() => undefined);
  }
  const canPictureInPicture =
    typeof document !== "undefined" &&
    document.pictureInPictureEnabled === true;
  return {
    ...(hasCaptions ? { onCaptions: toggleCaptions, isCaptionsOn } : {}),
    ...(canPictureInPicture ? { onPictureInPicture: pictureInPicture } : {}),
  };
}

interface ViewerScreenProps {
  readonly video: ConversationImage;
  readonly position: string;
  readonly hasNeighbours: boolean;
  readonly stage: React.RefObject<HTMLDivElement | null>;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly onBeside: () => void;
  readonly onToMessage: () => void;
  readonly onClose: () => void;
}

/** The head of the full screen: the dark variant of the head of the cards. */
function ViewerHead({
  video,
  position,
  onBeside,
  onToMessage,
  onClose,
}: Pick<
  ViewerScreenProps,
  "video" | "position" | "onBeside" | "onToMessage" | "onClose"
>): React.ReactElement {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const facts = useMediaFacts(video.attachment);
  const { attachment } = video;
  return (
    <CardHead
      actions={
        <>
          <CardDownloadAction
            download={{ href: downloadUrl(attachment) }}
            tone="dark"
          />
          <CardActionDivider tone="dark" />
          <CardAction
            icon={PanelRight}
            isIconOnly
            label={t("chatPage.cards.beside")}
            onClick={onBeside}
            tone="dark"
            variant="quiet"
          />
          <CardAction
            icon={MessageSquareText}
            isIconOnly
            label={t("chatPage.cards.toMessage")}
            onClick={onToMessage}
            tone="dark"
            variant="quiet"
          />
          <CardAction
            icon={X}
            isIconOnly
            label={t("chatPage.cards.close")}
            onClick={onClose}
            tone="dark"
            variant="quiet"
          />
        </>
      }
      className="px-3 sm:px-4"
      icon={Film}
      name={attachment.name}
      subtitle={
        <span data-viewer-position="" role="status">
          {subtitleOf([
            position,
            video.senderName,
            videoMeta(facts, attachment.sizeBytes, i18n.language),
            now === null ? null : retentionLabel(attachment.expiresAt, now, t),
          ])}
        </span>
      }
      tone="dark"
    />
  );
}

const ARROW_CLASS =
  "absolute top-1/2 z-10 flex size-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-viewer-control text-viewer-foreground ring-1 ring-viewer-edge hover:bg-viewer-control-hover focus-visible:outline-2 focus-visible:outline-primary";

/**
 * One video of the full screen with its controls over the picture;
 * a new video gets a new screen, which takes the file over from
 * the card and the split view.
 */
function ViewerScreen(props: ViewerScreenProps): React.ReactElement {
  const { t } = useTranslation();
  const { video, hasNeighbours, stage, onPrevious, onNext, onClose } = props;
  const { attachment } = video;
  const player = useVideoPlayer(attachment, true);
  const preview = useAttachmentPreview(attachment);
  const controls = useIdleControls(player.isPlaying);
  const extras = useViewerExtras(player.media, player.durationSeconds !== null);
  useVideoViewerKeys({
    toggle: player.toggle,
    skip: player.skip,
    previous: onPrevious,
    next: onNext,
    toggleFullscreen: () => toggleBrowserFullscreen(stage.current),
    toggleMute: player.toggleMute,
    close: onClose,
  });
  const fade = cn(
    "transition-opacity duration-300",
    controls.isVisible ? "opacity-100" : "pointer-events-none opacity-0",
  );
  return (
    <div
      className={cn(
        "relative flex min-h-0 flex-1 flex-col",
        !controls.isVisible && "cursor-none",
      )}
      data-controls-visible={controls.isVisible ? "true" : "false"}
      data-video-viewer={attachment.id}
      onPointerDown={controls.wake}
      onPointerMove={controls.wake}
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
        className="absolute inset-0 flex cursor-pointer items-center justify-center"
        onClick={player.toggle}
        type="button"
      >
        {player.isPlaying ? null : (
          <span className="flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-overlay">
            <Play
              aria-hidden="true"
              className="ml-0.5 size-7"
              fill="currentColor"
            />
          </span>
        )}
      </button>
      <div className={cn("relative z-10 bg-viewer-scrim/80", fade)}>
        <ViewerHead {...props} />
      </div>
      {hasNeighbours ? (
        <>
          <button
            aria-label={t("chatPage.video.previous")}
            className={cn(ARROW_CLASS, "left-3", fade)}
            onClick={onPrevious}
            type="button"
          >
            <ChevronLeft aria-hidden="true" className="size-6" />
          </button>
          <button
            aria-label={t("chatPage.video.next")}
            className={cn(ARROW_CLASS, "right-3", fade)}
            onClick={onNext}
            type="button"
          >
            <ChevronRight aria-hidden="true" className="size-6" />
          </button>
        </>
      ) : null}
      <div
        className={cn(
          "relative z-10 mt-auto bg-viewer-scrim/80 pb-[env(safe-area-inset-bottom)]",
          fade,
        )}
      >
        <VideoControlBar
          className="px-3 py-2 sm:px-4"
          extras={extras}
          player={player}
          tone="dark"
        />
      </div>
    </div>
  );
}

/**
 * The full screen of a video: a black stage with the controls
 * over the picture, which fade out after a short time without a movement.
 * @remarks
 * The head names the position among all videos of the chat ("1 / 3"),
 * sender, length, resolution and remaining time and offers Herunterladen,
 * Daneben, Zur Nachricht and Schließen; arrows on both sides change to the
 * previous and next video of the chat, which the server lists only for
 * members. The bar below has speed, subtitles (when the video has some),
 * sound and picture in picture. Keys: Space Start/Pause, ← → five seconds,
 * ⇧← ⇧→ previous and next video, F full screen of the browser, M sound,
 * Esc closes and hands the focus back to the message. The playback goes on
 * where the card or the split view was.
 */
export function ChatVideoViewer({
  card,
  onClose,
}: {
  readonly card: VideoOpenedCard;
  readonly onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const content = useChatContent();
  const stage = useRef<HTMLDivElement | null>(null);
  const opened = videoEntryOf(card);
  const { videos } = useChatVideos(content.conversationId, opened);
  const [currentId, setCurrentId] = useState(card.descriptor.attachment.id);
  const found = videos.findIndex((entry) => entry.attachment.id === currentId);
  const index = Math.max(found, 0);
  const video = videos[index] ?? opened;

  useEffect(() => {
    stage.current?.focus();
  }, []);

  function go(step: number): void {
    if (videos.length < 2) return;
    const next = videos[(index + step + videos.length) % videos.length];
    if (next) setCurrentId(next.attachment.id);
  }

  function close(isScrolled: boolean): void {
    if (document.fullscreenElement === stage.current)
      void document.exitFullscreen().catch(() => undefined);
    onClose();
    const element = messageElement(video.messageId);
    if (!element) return;
    if (isScrolled) element.scrollIntoView({ block: "center" });
    element.focus({ preventScroll: !isScrolled });
  }

  return (
    <div
      ref={stage}
      aria-label={t("chatPage.video.viewer")}
      aria-modal="true"
      className="fixed inset-0 z-50 flex flex-col bg-viewer-scrim text-viewer-foreground outline-none"
      role="dialog"
      tabIndex={-1}
    >
      <ViewerScreen
        key={video.attachment.id}
        hasNeighbours={videos.length > 1}
        onBeside={() => {
          close(false);
          content.openBeside(videoCardOf(video));
        }}
        onClose={() => close(false)}
        onNext={() => go(1)}
        onPrevious={() => go(-1)}
        onToMessage={() => close(true)}
        position={t("imageViewer.position", {
          current: index + 1,
          total: videos.length,
        })}
        stage={stage}
        video={video}
      />
    </div>
  );
}
