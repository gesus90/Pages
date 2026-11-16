import { useEffect, useState } from "react";

import { readChatMedia } from "./use-chat-images";

import type { ConversationImage } from "@/definition/ConversationContent";

/** The videos of a chat as the split view and the full screen offer them. */
export interface ChatVideos {
  readonly videos: readonly ConversationImage[];
  /** Whether the list of the whole chat is still on its way. */
  readonly isLoading: boolean;
}

/**
 * All videos of the opened chat, oldest first.
 * @remarks
 * The opened video shows at once; the list of the whole chat, with the
 * videos of older messages the page has not loaded yet, follows from the
 * server, which shows it only to members. When it cannot be read, or does not
 * contain the opened video, the opened video stays alone.
 * @param conversationId - The stored conversation; `null` keeps the opened video alone.
 * @param opened - The opened video with its message.
 */
export function useChatVideos(
  conversationId: string | null,
  opened: ConversationImage,
): ChatVideos {
  const [loaded, setLoaded] = useState<readonly ConversationImage[] | null>(
    null,
  );
  const [isLoading, setLoading] = useState(conversationId !== null);
  const attachmentId = opened.attachment.id;

  useEffect(() => {
    if (conversationId === null) return undefined;
    const controller = new AbortController();
    async function load(): Promise<void> {
      try {
        const response = await fetch(
          `/chat/videos/${encodeURIComponent(conversationId ?? "")}`,
          {
            signal: controller.signal,
            headers: { Accept: "application/json" },
          },
        );
        if (!response.ok) return;
        const videos = readChatMedia(await response.json(), "video");
        if (videos.some((video) => video.attachment.id === attachmentId))
          setLoaded(videos);
      } catch (error: unknown) {
        if (!controller.signal.aborted)
          console.warn("The videos of the chat could not be loaded.", error);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [conversationId, attachmentId]);

  return { videos: loaded ?? [opened], isLoading };
}

/**
 * The card of a video of the list, as "Daneben" and the full screen open it.
 *
 * @param video - The video with its message.
 */
export function videoCardOf(video: ConversationImage): {
  readonly key: string;
  readonly descriptor: {
    readonly kind: "video";
    readonly attachment: ConversationImage["attachment"];
  };
  readonly origin: {
    readonly senderName: string;
    readonly createdAt: string;
    readonly messageId: string;
  };
} {
  return {
    key: `att:${video.attachment.id}`,
    descriptor: { kind: "video", attachment: video.attachment },
    origin: {
      senderName: video.senderName,
      createdAt: video.sentAt,
      messageId: video.messageId,
    },
  };
}

/**
 * The opened card as an entry of the list of videos.
 *
 * @param card - The card of the opened video.
 */
export function videoEntryOf(card: {
  readonly descriptor: { readonly attachment: ConversationImage["attachment"] };
  readonly origin: {
    readonly senderName: string;
    readonly createdAt?: string;
    readonly messageId?: string;
  };
}): ConversationImage {
  return {
    attachment: card.descriptor.attachment,
    messageId: card.origin.messageId ?? "",
    senderId: "",
    senderName: card.origin.senderName,
    sentAt: card.origin.createdAt ?? card.descriptor.attachment.createdAt ?? "",
  };
}
