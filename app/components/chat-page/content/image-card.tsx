import { Image as ImageIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AttachmentPreviewButton } from "./attachment-preview";
import { downloadUrl, formatFileSize } from "./card-types";
import { useChatContent } from "./chat-content-context";
import { ContentCard } from "./content-card";
import { useRetention } from "./use-retention";

import type { ConversationAttachment } from "@/definition/ConversationContent";
import type { ChatContent } from "./chat-content-context";
import type { CardOrigin, OpenedCard } from "./card-types";

/**
 * The images of one message as the viewer knows them before it asks the
 * server for all images of the chat (PAGE-382).
 *
 * @param attachments - The images of the message.
 * @param origin - Sender, time and message.
 */
export function messageImages(
  attachments: readonly ConversationAttachment[],
  origin: CardOrigin,
): Parameters<ChatContent["openViewer"]>[0]["images"] {
  return attachments.map((attachment) => ({
    attachment,
    messageId: origin.messageId ?? "",
    senderId: "",
    senderName: origin.senderName,
    sentAt: origin.createdAt ?? attachment.createdAt ?? new Date(0).toISOString(),
  }));
}

/**
 * Opens the image viewer of the chat at one image (PAGE-382).
 *
 * @param content - The shared state of the cards.
 * @param opened - The image and the images of its message.
 */
export function openImageViewer(
  content: Pick<ChatContent, "openViewer">,
  opened: {
    readonly attachment: ConversationAttachment;
    readonly images: readonly ConversationAttachment[];
    readonly origin: CardOrigin;
  },
): void {
  const opener =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  content.openViewer({
    attachmentId: opened.attachment.id,
    images: messageImages(opened.images, opened.origin),
    opener,
  });
}

interface ImageCardProps {
  /** The card of the image, as the split view opens it. */
  readonly card: OpenedCard & {
    readonly descriptor: { readonly kind: "image" };
  };
}

/**
 * The card of the only image of a message (PAGE-298, PAGE-382): the preview
 * image under the shared head with Herunterladen, Daneben and Vollbild; a
 * click opens the image viewer of the chat. The original loads only there.
 */
export function ImageCard({ card }: ImageCardProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const content = useChatContent();
  const { attachment } = card.descriptor;
  const retention = useRetention(attachment.expiresAt);
  const open = (): void =>
    openImageViewer(content, {
      attachment,
      images: [attachment],
      origin: card.origin,
    });
  return (
    <ContentCard
      beside={card}
      cardKey={card.key}
      className="max-w-108"
      defaultState="expanded"
      download={{ href: downloadUrl(attachment) }}
      icon={ImageIcon}
      kindLabel={t("chatPage.cards.kind.image")}
      meta={formatFileSize(attachment.sizeBytes, i18n.language)}
      name={attachment.name}
      onFullscreen={open}
      retention={retention}
    >
      <AttachmentPreviewButton
        attachment={attachment}
        icon={ImageIcon}
        imageClassName="max-h-96 w-full object-cover"
        label={t("chatPage.cards.fullscreen")}
        onOpen={open}
      />
    </ContentCard>
  );
}
