import { Download, Images, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { AttachmentPreviewButton } from "./attachment-preview";
import { archiveUrl, downloadUrl, formatFileSize } from "./card-types";
import { useChatContent } from "./chat-content-context";
import { ContentCard } from "./content-card";
import { ExpiredAttachment } from "./expired-attachment";
import { earliestExpiry, isAttachmentExpired } from "./file-retention";
import { openImageViewer } from "./image-card";
import { useNow } from "./use-now";
import { useRetention } from "./use-retention";

import type { ConversationAttachment } from "@/definition/ConversationContent";
import type { CardOrigin } from "./card-types";

/** Most previews the grid of a gallery shows; the last one names the rest. */
export const GALLERY_TILES = 4;

const TILE_CLASS =
  "group relative aspect-square min-w-0 overflow-hidden rounded-md bg-panel-body";

interface GalleryTileProps {
  readonly attachment: ConversationAttachment;
  /** The images beyond the grid, named on the last tile as "+N". */
  readonly more: number;
  readonly isExpired: boolean;
  readonly onOpen: () => void;
}

/** One preview of a gallery: a click opens the viewer, a button loads the original. */
function GalleryTile({
  attachment,
  more,
  isExpired,
  onOpen,
}: GalleryTileProps): React.ReactElement {
  const { t } = useTranslation();
  if (isExpired)
    return (
      <li className={TILE_CLASS}>
        <ExpiredAttachment attachment={attachment} isCompact />
      </li>
    );
  return (
    <li className={TILE_CLASS}>
      <AttachmentPreviewButton
        attachment={attachment}
        className="size-full"
        icon={Images}
        imageClassName="size-full object-cover"
        isCompact
        label={t("chatPage.cards.fullscreen")}
        onOpen={onOpen}
      />
      {more > 0 ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-viewer-scrim/60 text-lg font-semibold text-viewer-foreground"
        >
          +{more}
        </span>
      ) : null}
      {/* Always shown on a touch screen; on a wide one while hovering or focused. */}
      <a
        aria-label={t("chatPage.cards.downloadNamed", { name: attachment.name })}
        className="absolute top-1.5 right-1.5 inline-flex size-7 items-center justify-center rounded-md bg-surface text-foreground shadow-xs ring-1 ring-border transition-opacity hover:text-primary focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-primary sm:opacity-0 sm:group-hover:opacity-100"
        download=""
        href={downloadUrl(attachment)}
        title={t("chatPage.cards.download")}
      >
        <Download aria-hidden="true" className="size-3.5" />
      </a>
    </li>
  );
}

/** A tile for an image that is still being generated (PAGE-382). */
export function GalleryPlaceholder(): React.ReactElement {
  const { t } = useTranslation();
  return (
    <li
      className={cn(
        TILE_CLASS,
        "flex animate-pulse items-center justify-center border border-dashed border-border",
      )}
    >
      <Loader2 aria-hidden="true" className="size-5 animate-spin text-muted-foreground" />
      <span className="sr-only">{t("chatPage.cards.gallery.pending")}</span>
    </li>
  );
}

interface ImageGalleryProps {
  /** The images of one message, at least two, in their order. */
  readonly attachments: readonly ConversationAttachment[];
  readonly origin: CardOrigin;
}

/**
 * The images of one answer as a compact gallery (PAGE-382): up to four
 * previews in a grid, "+N" on the last one for the rest, a download on each
 * image and "Alle herunterladen" as ZIP in the head with the remaining time.
 * A click opens the image viewer of the chat at the chosen image.
 */
export function ImageGallery({
  attachments,
  origin,
}: ImageGalleryProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const content = useChatContent();
  const now = useNow();
  const retention = useRetention(earliestExpiry(attachments));
  const isGone = (attachment: ConversationAttachment): boolean =>
    attachment.expiredAt !== undefined ||
    (now !== null && isAttachmentExpired(attachment, now));
  const kept = attachments.filter((attachment) => !isGone(attachment));
  const [first] = kept;
  const shown = attachments.slice(0, GALLERY_TILES);
  const more = attachments.length - shown.length;
  const size = kept.reduce((total, attachment) => total + attachment.sizeBytes, 0);
  const open = (attachment: ConversationAttachment): void =>
    openImageViewer(content, { attachment, images: attachments, origin });
  return (
    <ContentCard
      cardKey={`gallery:${attachments[0]?.id ?? "none"}`}
      className="max-w-108"
      defaultState="expanded"
      icon={Images}
      kindLabel={t("chatPage.cards.kind.gallery")}
      meta={
        <>
          {t("chatPage.cards.gallery.count", { count: attachments.length })}
          {size > 0 ? ` · ${formatFileSize(size, i18n.language)}` : null}
        </>
      }
      name={t("chatPage.cards.gallery.name", { count: attachments.length })}
      retention={retention}
      {...(origin.messageId !== undefined && kept.length > 0
        ? {
            download: {
              href: archiveUrl(origin.messageId),
              label: t("chatPage.cards.downloadAll"),
            },
          }
        : {})}
      {...(first ? { onFullscreen: () => open(first) } : {})}
    >
      <ul
        aria-label={t("chatPage.cards.gallery.name", { count: attachments.length })}
        className="grid grid-cols-2 gap-1 p-1"
        data-image-gallery=""
      >
        {shown.map((attachment, position) => (
          <GalleryTile
            key={attachment.id}
            attachment={attachment}
            isExpired={isGone(attachment)}
            more={position === shown.length - 1 ? more : 0}
            onOpen={() => open(attachment)}
          />
        ))}
      </ul>
    </ContentCard>
  );
}
