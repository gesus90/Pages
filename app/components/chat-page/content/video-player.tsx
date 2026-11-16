import { Film, Play } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { downloadUrl, formatFileSize } from "./card-types";
import { useChatContent } from "./chat-content-context";
import { ContentCard, subtitleOf } from "./content-card";
import {
  formatResolution,
  reportMediaFacts,
  useMediaFacts,
} from "./media-facts";
import { useAttachmentPreview } from "./use-attachment-preview";
import { formatSeconds, useMediaPlayer } from "./use-media-player";
import { useRetention } from "./use-retention";
import { VideoControlBar } from "./video-controls";

import type {
  ConversationAttachment,
  ConversationMediaFacts,
} from "@/definition/ConversationContent";
import type { OpenedCard } from "./card-types";
import type { MediaPlayer } from "./use-media-player";

/**
 * The length, the resolution and the size of a video, as its head and the
 * strips name them.
 * @param facts - Length and resolution, as far as known.
 * @param sizeBytes - The size of the file.
 * @param language - The language of the interface.
 */
export function videoMeta(
  facts: ConversationMediaFacts,
  sizeBytes: number,
  language: string,
): string {
  return subtitleOf([
    facts.durationSeconds === undefined
      ? null
      : formatSeconds(facts.durationSeconds),
    formatResolution(facts),
    formatFileSize(sizeBytes, language),
  ]);
}

const BADGE_CLASS =
  "absolute bottom-2 rounded-md bg-viewer-control px-1.5 py-0.5 text-[11px] font-medium text-viewer-foreground tabular-nums";

interface VideoPosterProps {
  readonly attachment: ConversationAttachment;
  readonly facts: ConversationMediaFacts;
  readonly isPending: boolean;
  readonly hasPreview: boolean;
  readonly onPlay: () => void;
}

/**
 * The preview of a video not started yet: a large round play
 * button in the accent color, the resolution bottom left and the length
 * bottom right.
 */
function VideoPoster({
  attachment,
  facts,
  isPending,
  hasPreview,
  onPlay,
}: VideoPosterProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const resolution = formatResolution(facts);
  return (
    <button
      aria-label={t("chatPage.video.playNamed", { name: attachment.name })}
      className="group absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-2 px-4 text-viewer-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      data-video-poster=""
      onClick={onPlay}
      type="button"
    >
      <span className="flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-overlay group-hover:bg-primary-hover">
        <Play
          aria-hidden="true"
          className="ml-0.5 size-7"
          fill="currentColor"
        />
      </span>
      {hasPreview ? null : (
        <span className="max-w-full truncate text-xs text-viewer-muted">
          {attachment.name} ·{" "}
          {formatFileSize(attachment.sizeBytes, i18n.language)}
          {isPending ? ` · ${t("chatPage.cards.previewPending")}` : null}
        </span>
      )}
      {resolution === null ? null : (
        <span className={cn(BADGE_CLASS, "left-2")} data-video-resolution="">
          {resolution}
        </span>
      )}
      {facts.durationSeconds === undefined ? null : (
        <span className={cn(BADGE_CLASS, "right-2")} data-video-duration="">
          {formatSeconds(facts.durationSeconds)}
        </span>
      )}
    </button>
  );
}

/**
 * The player of one video in the chat, with its state; the
 * full screen shows the same state with its own controls.
 *
 * @param attachment - The video.
 * @param isTakingOver - Whether this view takes the video over from another view.
 */
export function useVideoPlayer(
  attachment: ConversationAttachment,
  isTakingOver: boolean,
): MediaPlayer<HTMLVideoElement> {
  return useMediaPlayer<HTMLVideoElement>({
    attachmentId: attachment.id,
    isTakingOver,
    onMetadata: (metadata) => reportMediaFacts(attachment, metadata),
  });
}

interface VideoPlayerProps {
  readonly attachment: ConversationAttachment;
  /** Fills its container instead of keeping 16:9, for the split view. */
  readonly isFilling?: boolean;
  /** The split view: takes the video over from the card and plays on where it was. */
  readonly isTakingOver?: boolean;
  /** "Vollbild" in the bar. */
  readonly onFullscreen?: () => void;
}

/**
 * The video player of the chat with its own controls
 * in the colors of the theme.
 *
 * @remarks
 * Until the person starts it, only the preview image is loaded
 * (`preload="none"`) and the stage shows a large play button with the
 * resolution and the length; the original streams from the start on, and
 * the bar appears. The video joins the one playback of the page: it starts
 * where it stopped in another view, and starting it pauses every other
 * medium.
 */
export function VideoPlayer({
  attachment,
  isFilling = false,
  isTakingOver = false,
  onFullscreen,
}: VideoPlayerProps): React.ReactElement {
  const player = useVideoPlayer(attachment, isTakingOver);
  const preview = useAttachmentPreview(attachment);
  const facts = useMediaFacts(attachment);
  const isStarted = player.hasStarted || player.positionSeconds > 0;
  return (
    <div
      className={cn(
        "flex flex-col bg-viewer-scrim",
        isFilling && "min-h-0 flex-1",
      )}
      data-video-player={attachment.id}
    >
      <div
        ref={preview.target}
        className={cn(
          "relative",
          isFilling ? "min-h-0 flex-1" : "aspect-video",
        )}
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
        {isStarted ? (
          <button
            aria-hidden="true"
            className="absolute inset-0 cursor-pointer"
            onClick={player.toggle}
            tabIndex={-1}
            type="button"
          />
        ) : (
          <VideoPoster
            attachment={attachment}
            facts={facts}
            hasPreview={preview.previewUrl !== null}
            isPending={preview.isPending}
            onPlay={player.toggle}
          />
        )}
      </div>
      {isStarted ? (
        <VideoControlBar
          className="shrink-0 border-t border-border bg-surface"
          onFullscreen={onFullscreen}
          player={player}
          tone="light"
        />
      ) : null}
    </div>
  );
}

interface VideoCardProps {
  /** The card of the video, as the split view and the full screen open it. */
  readonly card: OpenedCard & {
    readonly descriptor: { readonly kind: "video" };
  };
}

/**
 * The card of a video of a message: the shared head
 * with kind, length, resolution, size and remaining time, Herunterladen,
 * Daneben, Vollbild and Zuklappen, and the player.
 */
export function VideoCard({ card }: VideoCardProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const content = useChatContent();
  const { attachment } = card.descriptor;
  const retention = useRetention(attachment.expiresAt);
  const facts = useMediaFacts(attachment);
  return (
    <ContentCard
      beside={card}
      cardKey={card.key}
      className="max-w-lg"
      defaultState="expanded"
      download={{ href: downloadUrl(attachment) }}
      icon={Film}
      kindLabel={t("chatPage.cards.kind.video")}
      meta={videoMeta(facts, attachment.sizeBytes, i18n.language)}
      name={attachment.name}
      onFullscreen={() => content.openOverlay(card)}
      retention={retention}
    >
      <VideoPlayer
        attachment={attachment}
        onFullscreen={() => content.openOverlay(card)}
      />
    </ContentCard>
  );
}
