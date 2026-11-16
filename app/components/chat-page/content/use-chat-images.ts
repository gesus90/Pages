import { useEffect, useState } from "react";

import type {
  ConversationAttachment,
  ConversationImage,
} from "@/definition/ConversationContent";

/** The images of a chat as the viewer pages through them. */
export interface ChatImages {
  readonly images: readonly ConversationImage[];
  /** Whether the list of the whole chat is still on its way. */
  readonly isLoading: boolean;
}

function isText(value: unknown): value is string {
  return typeof value === "string";
}

function readAttachment(
  value: unknown,
  wanted: "image" | "video",
): ConversationAttachment | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, name, url, mimeType, sizeBytes, kind } = value as Record<
    string,
    unknown
  >;
  if (!isText(id) || !isText(name) || !isText(url) || !isText(mimeType))
    return null;
  if (typeof sizeBytes !== "number" || kind !== wanted) return null;
  // The server is the source; only the shape is checked here.
  return value as ConversationAttachment;
}

function readImage(
  value: unknown,
  wanted: "image" | "video",
): ConversationImage | null {
  if (typeof value !== "object" || value === null) return null;
  const entry = value as Record<string, unknown>;
  const attachment = readAttachment(entry.attachment, wanted);
  if (!attachment || !isText(entry.messageId) || !isText(entry.sentAt))
    return null;
  return {
    attachment,
    messageId: entry.messageId,
    senderId: isText(entry.senderId) ? entry.senderId : "",
    senderName: isText(entry.senderName) ? entry.senderName : "",
    sentAt: entry.sentAt,
  };
}

/**
 * Reads the answer of `GET /chat/images/<conversationId>`.
 * @param body - The parsed JSON body.
 * @returns The images it lists; entries of another shape are left out.
 */
export function readChatImages(body: unknown): ConversationImage[] {
  return readChatMedia(body, "image");
}

/**
 * Reads the answer of `GET /chat/images/<id>` or
 * `GET /chat/videos/<id>`.
 * @param body - The parsed JSON body.
 * @param kind - `image` reads the list `images`, `video` the list `videos`.
 * @returns The files it lists; entries of another shape or kind are left out.
 */
export function readChatMedia(
  body: unknown,
  kind: "image" | "video",
): ConversationImage[] {
  const key = kind === "video" ? "videos" : "images";
  if (typeof body !== "object" || body === null || !(key in body)) return [];
  const list: unknown = Reflect.get(body, key);
  if (!Array.isArray(list)) return [];
  return list
    .map((entry: unknown) => readImage(entry, kind))
    .filter((image) => image !== null);
}

/**
 * All images of the opened chat for the viewer, oldest first.
 * @remarks
 * The images of the message that opened the viewer show at once; the list
 * of the whole chat, with the images of older messages the page has not
 * loaded yet, follows from the server, which shows it only to members. When
 * it cannot be read, or does not contain the opened image, the images of the
 * message stay.
 * @param conversationId - The stored conversation; `null` keeps the images of the message.
 * @param request - The opened image and the images of its message.
 */
export function useChatImages(
  conversationId: string | null,
  request: {
    readonly attachmentId: string;
    readonly images: readonly ConversationImage[];
  },
): ChatImages {
  const [loaded, setLoaded] = useState<readonly ConversationImage[] | null>(
    null,
  );
  const [isLoading, setLoading] = useState(conversationId !== null);
  const { attachmentId } = request;

  useEffect(() => {
    if (conversationId === null) return undefined;
    const controller = new AbortController();
    async function load(): Promise<void> {
      try {
        const response = await fetch(
          `/chat/images/${encodeURIComponent(conversationId ?? "")}`,
          {
            signal: controller.signal,
            headers: { Accept: "application/json" },
          },
        );
        if (!response.ok) return;
        const images = readChatImages(await response.json());
        if (images.some((image) => image.attachment.id === attachmentId))
          setLoaded(images);
      } catch (error: unknown) {
        if (!controller.signal.aborted)
          console.warn("The images of the chat could not be loaded.", error);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [conversationId, attachmentId]);

  return { images: loaded ?? request.images, isLoading };
}
