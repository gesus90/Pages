import { useEffect, useState } from "react";

import { CONVERSATION_THUMBNAIL_MAXIMUM_BYTES } from "@/definition/ConversationContent";

import { createThumbnail } from "./media-thumbnails";
import { useSeen } from "./use-seen";

import type { ConversationAttachment } from "@/definition/ConversationContent";

/** Largest original the browser reads to create a missing preview: 64 MB. */
const PREVIEW_SOURCE_MAXIMUM_BYTES = 64 * 1024 * 1024;

const PREVIEW_KINDS: readonly string[] = ["image", "video", "pdf"];

/**
 * Preview addresses the server stored during this visit, by attachment ID, so
 * a card that is collapsed and expanded again does not create its preview twice.
 */
const storedPreviews = new Map<string, string>();

/** The preview of an attachment as a card shows it. */
export interface AttachmentPreview {
  /** The address of the preview image; `null` without one. */
  readonly previewUrl: string | null;
  /** Whether the browser is creating the missing preview right now. */
  readonly isPending: boolean;
  /** Ref of the element whose visibility starts the creation of a missing preview. */
  readonly target: (element: Element | null) => void;
}

function readThumbnailUrl(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("attachment" in body))
    return null;
  const { attachment } = body;
  if (typeof attachment !== "object" || attachment === null) return null;
  if (!("thumbnailUrl" in attachment)) return null;
  return typeof attachment.thumbnailUrl === "string"
    ? attachment.thumbnailUrl
    : null;
}

/** Stores a created preview on the server, for everyone who reads the message later. */
async function uploadPreview(
  attachmentId: string,
  preview: Blob,
): Promise<void> {
  if (preview.size > CONVERSATION_THUMBNAIL_MAXIMUM_BYTES) return;
  const response = await fetch(
    `/chat-page-api/files?attachmentId=${encodeURIComponent(attachmentId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": preview.type },
      body: preview,
    },
  );
  if (!response.ok) return;
  const thumbnailUrl = readThumbnailUrl(await response.json());
  if (thumbnailUrl !== null) storedPreviews.set(attachmentId, thumbnailUrl);
}

/** Reads the original and creates its preview; `null` when that is not possible. */
async function createPreview(
  attachment: Pick<ConversationAttachment, "id" | "url" | "mimeType">,
  signal: AbortSignal,
): Promise<Blob | null> {
  const response = await fetch(attachment.url, { signal });
  if (!response.ok) return null;
  const preview = await createThumbnail(
    await response.blob(),
    attachment.mimeType,
  );
  if (preview && !signal.aborted)
    void uploadPreview(attachment.id, preview).catch(() => undefined);
  return preview;
}

/**
 * The preview image of an attachment (PAGE-298).
 *
 * @remarks
 * A file an agent attached has no preview image. The browser of the first
 * person who sees its card then reads the original once, creates the preview,
 * shows it at once and stores it on the server. That happens only for images,
 * videos and PDFs of at most 64 MB and only once the element given to
 * `target` is visible. The created image is released again on unmount.
 *
 * @param attachment - The attachment of the card.
 * @returns The address of the preview, whether it is being created, and the
 * ref for the element that has to be visible first.
 */
export function useAttachmentPreview(
  attachment: ConversationAttachment,
): AttachmentPreview {
  const [element, setElement] = useState<Element | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [hasEnded, setEnded] = useState(false);
  const isSeen = useSeen(element);
  const known = attachment.thumbnailUrl ?? storedPreviews.get(attachment.id);
  const isMissing =
    known === undefined &&
    PREVIEW_KINDS.includes(attachment.kind) &&
    attachment.sizeBytes <= PREVIEW_SOURCE_MAXIMUM_BYTES;
  const isWanted = isMissing && isSeen;
  const { id, url, mimeType } = attachment;

  useEffect(() => {
    if (!isWanted) return undefined;
    const controller = new AbortController();
    let address: string | null = null;
    async function create(): Promise<void> {
      const preview = await createPreview(
        { id, url, mimeType },
        controller.signal,
      ).catch(() => null);
      if (controller.signal.aborted) return;
      if (preview) {
        address = URL.createObjectURL(preview);
        setCreated(address);
      }
      setEnded(true);
    }
    void create();
    return () => {
      controller.abort();
      if (address !== null) URL.revokeObjectURL(address);
    };
  }, [isWanted, id, url, mimeType]);

  return {
    previewUrl: known ?? created,
    isPending: isMissing && !hasEnded && created === null,
    target: setElement,
  };
}
