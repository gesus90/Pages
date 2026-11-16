import {
  Clock,
  Image as ImageIcon,
  MessageSquareText,
  PanelRight,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ImageViewer } from "@/app/components/ui/image-viewer";
import { cn } from "@/app/lib/cn";

import { downloadUrl } from "./card-types";
import {
  CardAction,
  CardActionDivider,
  CardDownloadAction,
  CardHead,
  subtitleOf,
} from "./content-card";
import {
  isAttachmentExpired,
  retentionLabel,
  storedDate,
} from "./file-retention";
import { useChatImages } from "./use-chat-images";
import { useNow } from "./use-now";

import type { ViewerImage } from "@/app/lib/viewer-images";
import type { ConversationImage } from "@/definition/ConversationContent";
import type { ChatContent, ChatImageRequest } from "./chat-content-context";

/**
 * The message element of the chat history, which takes the focus back.
 * @param messageId - The stored message; empty finds none.
 */
export function messageElement(messageId: string): HTMLElement | null {
  if (messageId === "") return null;
  // Compared by value, so an ID never needs escaping for a selector.
  return (
    [...document.querySelectorAll<HTMLElement>("[data-chat-message]")].find(
      (element) => element.dataset.chatMessage === messageId,
    ) ?? null
  );
}

interface ViewerHeadProps {
  readonly image: ConversationImage;
  readonly position: string;
  readonly now: number | null;
  readonly onBeside: () => void;
  readonly onToMessage: () => void;
  readonly onClose: () => void;
}

/**
 * The head of the image viewer of a chat, the dark variant of the
 * head of the cards: position, sender, time and remaining time, then
 * Herunterladen, Daneben, Zur Nachricht and Schließen.
 */
function ViewerHead({
  image,
  position,
  now,
  onBeside,
  onToMessage,
  onClose,
}: ViewerHeadProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const { attachment } = image;
  const isExpired = now !== null && isAttachmentExpired(attachment, now);
  const isGone = attachment.expiredAt !== undefined || isExpired;
  const sent = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(image.sentAt));
  return (
    <CardHead
      actions={
        <>
          {isGone ? null : (
            <CardDownloadAction
              download={{ href: downloadUrl(attachment) }}
              tone="dark"
            />
          )}
          {isGone ? null : <CardActionDivider tone="dark" />}
          {isGone ? null : (
            <CardAction
              icon={PanelRight}
              isIconOnly
              label={t("chatPage.cards.beside")}
              onClick={onBeside}
              tone="dark"
              variant="quiet"
            />
          )}
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
            label={t("imageViewer.close")}
            onClick={onClose}
            tone="dark"
            variant="quiet"
          />
        </>
      }
      className="shrink-0 px-3 sm:px-4"
      icon={ImageIcon}
      name={attachment.name}
      subtitle={
        <span data-viewer-position="" role="status">
          {subtitleOf([
            position,
            image.senderName,
            sent,
            now === null ? null : retentionLabel(attachment.expiresAt, now, t),
          ])}
        </span>
      }
      tone="dark"
    />
  );
}

interface ViewerStripProps {
  readonly images: readonly ConversationImage[];
  readonly index: number;
  readonly now: number | null;
  readonly onSelect: (index: number) => void;
}

/** The strip of all images of the chat below the image; only previews load. */
function ViewerStrip({
  images,
  index,
  now,
  onSelect,
}: ViewerStripProps): React.ReactElement | null {
  const { t } = useTranslation();
  const active = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    active.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [index]);
  if (images.length < 2) return null;
  return (
    <nav
      aria-label={t("chatPage.cards.viewerStrip")}
      className="hidden shrink-0 justify-center overflow-x-auto px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex"
    >
      <ol className="flex gap-1.5">
        {images.map((image, position) => {
          const { attachment } = image;
          const isGone =
            attachment.expiredAt !== undefined ||
            (now !== null && isAttachmentExpired(attachment, now));
          const isCurrent = position === index;
          return (
            <li key={attachment.id}>
              <button
                ref={isCurrent ? active : undefined}
                aria-current={isCurrent ? "true" : undefined}
                aria-label={t("imageViewer.unnamed", {
                  current: position + 1,
                  total: images.length,
                })}
                className={cn(
                  "flex size-12 items-center justify-center overflow-hidden rounded-md bg-viewer-control ring-1 ring-viewer-edge focus-visible:outline-2 focus-visible:outline-primary",
                  isCurrent && "ring-2 ring-primary",
                )}
                onClick={() => onSelect(position)}
                type="button"
              >
                {isGone || attachment.thumbnailUrl === undefined ? (
                  <Icon isGone={isGone} />
                ) : (
                  <img
                    alt=""
                    className="size-full object-cover"
                    decoding="async"
                    loading="lazy"
                    src={attachment.thumbnailUrl}
                  />
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Icon({ isGone }: { readonly isGone: boolean }): React.ReactElement {
  const Glyph = isGone ? Clock : ImageIcon;
  return <Glyph aria-hidden="true" className="size-4 text-viewer-muted" />;
}

/** The images of the viewer: an expired file is reported in its place. */
function viewerImages(
  images: readonly ConversationImage[],
  now: number | null,
  expiredLabel: (image: ConversationImage) => string,
): ViewerImage[] {
  return images.map((image) => {
    const { attachment } = image;
    const isGone =
      attachment.expiredAt !== undefined ||
      (now !== null && isAttachmentExpired(attachment, now));
    return {
      src: attachment.url,
      alt: attachment.name,
      linkHref: null,
      ...(isGone ? { unavailable: expiredLabel(image) } : {}),
    };
  });
}

interface ChatImageViewerProps {
  readonly content: Pick<
    ChatContent,
    "conversationId" | "closeViewer" | "openBeside"
  >;
  readonly request: ChatImageRequest;
}

/**
 * The image viewer of a chat: the shared {@link ImageViewer}
 * over the chat, paging with ← and →, the arrows or a swipe through all
 * images of the opened chat in the order they were sent.
 * @remarks
 * Images of older messages the page has not loaded come from the server,
 * which lists them only for members. An image that cannot load or expired is
 * reported in its place; the others stay reachable. Escape closes and hands
 * the focus back to the message; "Zur Nachricht" goes to the message of the
 * shown image, "Daneben" opens it next to the chat.
 */
export function ChatImageViewer({
  content,
  request,
}: ChatImageViewerProps): React.ReactElement | null {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const { images } = useChatImages(content.conversationId, request);
  const [currentId, setCurrentId] = useState(request.attachmentId);
  const focusTarget = useRef<{ messageId: string; isScrolled: boolean } | null>(
    null,
  );
  const found = images.findIndex((image) => image.attachment.id === currentId);
  const index = Math.max(found, 0);
  const image = images[index];
  const opened = images.find(
    (entry) => entry.attachment.id === request.attachmentId,
  );
  if (!image) return null;

  function close(target: { messageId: string; isScrolled: boolean }): void {
    focusTarget.current = target;
    content.closeViewer();
  }

  function handleCloseAutoFocus(event: Event): void {
    const target = focusTarget.current ?? {
      messageId: opened?.messageId ?? "",
      isScrolled: false,
    };
    const element = messageElement(target.messageId) ?? request.opener ?? null;
    if (!element) return;
    event.preventDefault();
    if (target.isScrolled) element.scrollIntoView({ block: "center" });
    element.focus({ preventScroll: !target.isScrolled });
  }

  function handleBeside(): void {
    if (!image) return;
    close({ messageId: image.messageId, isScrolled: false });
    content.openBeside({
      key: `att:${image.attachment.id}`,
      descriptor: { kind: "image", attachment: image.attachment },
      origin: {
        senderName: image.senderName,
        createdAt: image.sentAt,
        messageId: image.messageId,
      },
    });
  }

  return (
    <ImageViewer
      footer={
        <ViewerStrip
          images={images}
          index={index}
          now={now}
          onSelect={(position) =>
            setCurrentId(images[position]?.attachment.id ?? currentId)
          }
        />
      }
      header={
        <ViewerHead
          image={image}
          now={now}
          onBeside={handleBeside}
          onClose={() =>
            close({
              messageId: opened?.messageId ?? image.messageId,
              isScrolled: false,
            })
          }
          onToMessage={() =>
            close({ messageId: image.messageId, isScrolled: true })
          }
          position={t("imageViewer.position", {
            current: index + 1,
            total: images.length,
          })}
        />
      }
      images={viewerImages(images, now, (entry) =>
        t("chatPage.cards.expired.label", {
          date: storedDate(entry.attachment, i18n.language),
        }),
      )}
      index={index}
      onClose={() =>
        close({
          messageId: opened?.messageId ?? image.messageId,
          isScrolled: false,
        })
      }
      onCloseAutoFocus={handleCloseAutoFocus}
      onIndexChange={(position) =>
        setCurrentId(images[position]?.attachment.id ?? currentId)
      }
    />
  );
}
