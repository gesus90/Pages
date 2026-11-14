import { Clock, Film, Play } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useChatContent } from "./chat-content-context";
import { isAttachmentExpired } from "./file-retention";
import { formatSeconds } from "./use-media-player";
import { useNow } from "./use-now";
import { useChatVideos, videoCardOf, videoEntryOf } from "./use-chat-videos";
import { VideoPlayer } from "./video-player";

import type { ConversationImage } from "@/definition/ConversationContent";
import type { OpenedCard } from "./card-types";

/** The card of a video, as the split view shows it. */
export type VideoOpenedCard = OpenedCard & {
  readonly descriptor: Extract<OpenedCard["descriptor"], { readonly kind: "video" }>;
};

/**
 * Whether an opened card is a video.
 *
 * @param card - The opened card.
 */
export function isVideoCard(card: OpenedCard): card is VideoOpenedCard {
  return card.descriptor.kind === "video";
}

interface VideoTileProps {
  readonly video: ConversationImage;
  readonly isGone: boolean;
  readonly onSelect: () => void;
}

/** One small preview of another video of the chat; only its preview image loads. */
function VideoTile({ video, isGone, onSelect }: VideoTileProps): React.ReactElement {
  const { t } = useTranslation();
  const { attachment } = video;
  const Glyph = isGone ? Clock : Film;
  return (
    <button
      aria-label={t("chatPage.video.openOther", { name: attachment.name })}
      className="group flex w-36 shrink-0 cursor-pointer flex-col gap-1 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-default"
      data-video-tile={attachment.id}
      disabled={isGone}
      onClick={onSelect}
      type="button"
    >
      <span className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg bg-viewer-scrim ring-1 ring-border group-hover:ring-primary">
        {isGone || attachment.thumbnailUrl === undefined ? (
          <Glyph aria-hidden="true" className="size-5 text-viewer-muted" />
        ) : (
          <img
            alt=""
            className="size-full object-cover"
            decoding="async"
            loading="lazy"
            src={attachment.thumbnailUrl}
          />
        )}
        {isGone ? null : (
          <span className="absolute flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Play aria-hidden="true" className="ml-px size-3.5" fill="currentColor" />
          </span>
        )}
        {attachment.durationSeconds === undefined ? null : (
          <span className="absolute right-1 bottom-1 rounded bg-viewer-control px-1 text-[10px] text-viewer-foreground tabular-nums">
            {formatSeconds(attachment.durationSeconds)}
          </span>
        )}
      </span>
      <span className="truncate text-xs font-medium text-foreground">{attachment.name}</span>
      <span className="truncate text-[11px] text-muted-foreground">{video.senderName}</span>
    </button>
  );
}

interface OtherVideosProps {
  readonly videos: readonly ConversationImage[];
  readonly currentId: string;
  readonly onSelect: (video: ConversationImage) => void;
}

/** "Weitere Videos in diesem Chat" below the open video (PAGE-384). */
function OtherVideos({
  videos,
  currentId,
  onSelect,
}: OtherVideosProps): React.ReactElement | null {
  const { t } = useTranslation();
  const now = useNow();
  const others = videos.filter((video) => video.attachment.id !== currentId);
  if (others.length === 0) return null;
  return (
    <nav
      aria-label={t("chatPage.video.others")}
      className="shrink-0 border-t border-border bg-surface px-4 py-3"
      data-other-videos={others.length}
    >
      <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
        {t("chatPage.video.others")}
      </h3>
      <ul className="flex gap-3 overflow-x-auto pb-1">
        {others.map((video) => (
          <li key={video.attachment.id}>
            <VideoTile
              isGone={
                video.attachment.expiredAt !== undefined ||
                (now !== null && isAttachmentExpired(video.attachment, now))
              }
              onSelect={() => onSelect(video)}
              video={video}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * A video next to the chat (PAGE-384): the player as large as the split
 * view, which takes the video over from its card and plays on where it was,
 * and below it the other videos of the chat to change to.
 *
 * @param card - The opened video.
 */
export function VideoPanelBody({
  card,
}: {
  readonly card: VideoOpenedCard;
}): React.ReactElement {
  const content = useChatContent();
  const { videos } = useChatVideos(content.conversationId, videoEntryOf(card));
  const { attachment } = card.descriptor;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-video-panel={attachment.id}>
      <VideoPlayer
        key={attachment.id}
        attachment={attachment}
        isFilling
        isTakingOver
        onFullscreen={() => content.openOverlay(card)}
      />
      <OtherVideos
        currentId={attachment.id}
        onSelect={(video) => content.openBeside(videoCardOf(video))}
        videos={videos}
      />
    </div>
  );
}
