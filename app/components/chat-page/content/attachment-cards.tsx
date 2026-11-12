import { AudioCard } from "./audio-player";
import { FileCard } from "./file-card";
import { ImageCard } from "./image-card";
import { PdfCard } from "./pdf-card";
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

/**
 * The cards of the file attachments of one message (PAGE-298): all images
 * together as a row, then every other attachment as its own card, in order.
 *
 * @remarks
 * Every card remembers its state under `att:<attachment id>`. Images, videos
 * and audio start expanded, a PDF collapsed. Only preview images load in the
 * message; an original loads when it is opened, played or loaded.
 *
 * @returns The cards, or `null` for a message without attachments.
 */
export function AttachmentCards({
  attachments,
  origin,
}: AttachmentCardsProps): React.ReactElement | null {
  if (attachments.length === 0) return null;
  const images = attachments.filter(({ kind }) => kind === "image");
  const others = attachments.filter(({ kind }) => kind !== "image");
  return (
    <div className="flex min-w-0 flex-col gap-3" data-attachment-cards="">
      {images.length > 0 ? (
        <div className="flex flex-wrap gap-3">
          {images.map((attachment) => (
            <ImageCard
              key={attachment.id}
              card={{
                key: `att:${attachment.id}`,
                descriptor: { kind: "image", attachment },
                origin,
              }}
              isSingle={images.length === 1}
            />
          ))}
        </div>
      ) : null}
      {others.map((attachment) => (
        <AttachmentCard
          key={attachment.id}
          attachment={attachment}
          origin={origin}
        />
      ))}
    </div>
  );
}
