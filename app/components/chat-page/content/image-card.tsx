import { Download, Image as ImageIcon, Maximize2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AttachmentPreviewButton } from "./attachment-preview";
import { downloadUrl, formatFileSize } from "./card-types";
import { useChatContent } from "./chat-content-context";
import { CardAction, ContentCard } from "./content-card";

import type { OpenedCard } from "./card-types";

interface ImageCardProps {
  /** The card of the image, as the split view and the full screen open it. */
  readonly card: OpenedCard & {
    readonly descriptor: { readonly kind: "image" };
  };
  /** A message's only image may be larger than the tiles of a row. */
  readonly isSingle: boolean;
}

/**
 * The card of an image of a message (PAGE-298): the preview image with
 * Vollbild, Laden and Daneben. The original loads only for those.
 */
export function ImageCard({
  card,
  isSingle,
}: ImageCardProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const content = useChatContent();
  const { attachment } = card.descriptor;
  const open = (): void => content.openOverlay(card);
  return (
    <ContentCard
      actions={
        <>
          <CardAction
            icon={Maximize2}
            isIconOnly={!isSingle}
            label={t("chatPage.cards.fullscreen")}
            onClick={open}
          />
          <CardAction
            href={downloadUrl(attachment)}
            icon={Download}
            isIconOnly={!isSingle}
            label={t("chatPage.cards.download")}
          />
        </>
      }
      beside={card}
      cardKey={card.key}
      className={isSingle ? "max-w-108" : "max-w-75"}
      defaultState="expanded"
      icon={ImageIcon}
      kindLabel={t("chatPage.cards.kind.image")}
      meta={formatFileSize(attachment.sizeBytes, i18n.language)}
      name={attachment.name}
    >
      <AttachmentPreviewButton
        attachment={attachment}
        icon={ImageIcon}
        imageClassName={
          isSingle ? "max-h-96 w-full object-cover" : "h-44 w-full object-cover"
        }
        label={t("chatPage.cards.fullscreen")}
        onOpen={open}
      />
    </ContentCard>
  );
}
