import { AudioCard } from "./audio-player";
import { ExpiredAttachment } from "./expired-attachment";
import { FileCard } from "./file-card";
import { isAttachmentExpired } from "./file-retention";
import { ImageCard } from "./image-card";
import { ImageGallery } from "./image-gallery";
import { PdfCard } from "./pdf-card";
import { useNow } from "./use-now";
import { VideoCard } from "./video-player";

import type { ConversationAttachment } from "@/definition/ConversationContent";
import type { CardOrigin } from "./card-types";

interface AttachmentCardsProps {
  /** The attachments of one message, in their order. */
  readonly attachments: readonly ConversationAttachment[];
  /** Who sent the message and when, for the head of the split view. */
  readonly origin: CardOrigin;
}

interface AttachmentCardProps {
  readonly attachment: ConversationAttachment;
  readonly origin: CardOrigin;
}

/** The card of one attachment that is not an image. */
function AttachmentCard({
  attachment,
  origin,
}: AttachmentCardProps): React.ReactElement {
  const key = `att:${attachment.id}`;
  switch (attachment.kind) {
    case "pdf":
      return (
        <PdfCard
          card={{ key, descriptor: { kind: "pdf", attachment }, origin }}
        />
      );
    case "video":
      return (
        <VideoCard
          card={{ key, descriptor: { kind: "video", attachment }, origin }}
        />
      );
    case "audio":
      return <AudioCard attachment={attachment} />;
    case "image":
    case "file":
      return <FileCard attachment={attachment} />;
  }
}

interface ImageCardsProps {
  readonly images: readonly ConversationAttachment[];
  readonly origin: CardOrigin;
  readonly isGone: (attachment: ConversationAttachment) => boolean;
}

/** The images of a message: one as a card, several as a gallery (PAGE-382). */
function ImageCards({
  images,
  origin,
  isGone,
}: ImageCardsProps): React.ReactElement | null {
  const [only] = images;
  if (!only) return null;
  if (images.length > 1)
    return <ImageGallery attachments={images} origin={origin} />;
  if (isGone(only)) return <ExpiredAttachment attachment={only} />;
  return (
    <ImageCard
      card={{
        key: `att:${only.id}`,
        descriptor: { kind: "image", attachment: only },
        origin,
      }}
    />
  );
}

/**
 * The cards of the file attachments of one message (PAGE-298, PAGE-382):
 * one image as its card, several as a gallery, then every other attachment
 * as its own card, in order.
 *
 * @remarks
 * Every card remembers its state under `att:<attachment id>`, a gallery
 * under `gallery:<first image id>`. Images, videos and audio start
 * expanded, a PDF collapsed. Only preview images load in the message; an
 * original loads when it is opened, played or loaded. A file of an agent
 * whose 72 hours ended shows a placeholder with name and date instead.
 *
 * @returns The cards, or `null` for a message without attachments.
 */
export function AttachmentCards({
  attachments,
  origin,
}: AttachmentCardsProps): React.ReactElement | null {
  const now = useNow();
  if (attachments.length === 0) return null;
  const isGone = (attachment: ConversationAttachment): boolean =>
    attachment.expiredAt !== undefined ||
    (now !== null && isAttachmentExpired(attachment, now));
  const images = attachments.filter(({ kind }) => kind === "image");
  const others = attachments.filter(({ kind }) => kind !== "image");
  return (
    <div className="flex min-w-0 flex-col gap-3" data-attachment-cards="">
      <ImageCards images={images} isGone={isGone} origin={origin} />
      {others.map((attachment) =>
        isGone(attachment) ? (
          <ExpiredAttachment key={attachment.id} attachment={attachment} />
        ) : (
          <AttachmentCard
            key={attachment.id}
            attachment={attachment}
            origin={origin}
          />
        ),
      )}
    </div>
  );
}
