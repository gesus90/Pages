import { useEffect, useState } from "react";

import {
  CONVERSATION_MEDIA_TABS,
  mediaOverviewUrl,
} from "@/definition/ConversationMediaOverview";

import type { ConversationAttachment } from "@/definition/ConversationContent";
import type {
  ConversationMediaFile,
  ConversationMediaFileTab,
  ConversationMediaLink,
  ConversationMediaOverview,
  ConversationMediaSender,
} from "@/definition/ConversationMediaOverview";

function isText(value: unknown): value is string {
  return typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFileTab(value: unknown): value is ConversationMediaFileTab {
  return CONVERSATION_MEDIA_TABS.some(
    (tab) => tab !== "links" && tab === value,
  );
}

function readAttachment(candidate: unknown): ConversationAttachment | null {
  if (!isRecord(candidate)) return null;
  const { id, name, url, mimeType, sizeBytes, kind } = candidate;
  if (!isText(id) || !isText(name) || !isText(url) || !isText(mimeType))
    return null;
  if (typeof sizeBytes !== "number" || !isText(kind)) return null;
  const checked: object = candidate;
  // The server is the source; only the shape is checked here.
  return checked as ConversationAttachment;
}

function readFile(value: unknown): ConversationMediaFile | null {
  if (!isRecord(value) || !isFileTab(value.tab)) return null;
  const attachment = readAttachment(value.attachment);
  const { messageId, senderId, sentAt } = value;
  if (!attachment || !isText(messageId) || !isText(senderId) || !isText(sentAt))
    return null;
  return { tab: value.tab, attachment, messageId, senderId, sentAt };
}

function readLink(value: unknown): ConversationMediaLink | null {
  if (!isRecord(value)) return null;
  const { url, domain, title, imageUrl, messageId, senderId, sentAt } = value;
  if (!isText(url) || !isText(domain) || !isText(messageId)) return null;
  if (!isText(senderId) || !isText(sentAt)) return null;
  return {
    url,
    domain,
    title: isText(title) ? title : "",
    imageUrl: isText(imageUrl) ? imageUrl : null,
    messageId,
    senderId,
    sentAt,
  };
}

function readSender(value: unknown): ConversationMediaSender | null {
  if (!isRecord(value)) return null;
  const { id, name, kind } = value;
  if (!isText(id) || !isText(name)) return null;
  return { id, name, kind: kind === "agent" ? "agent" : "human" };
}

function readList<T>(value: unknown, read: (entry: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry: unknown) => read(entry))
    .filter((entry): entry is T => entry !== null);
}

/**
 * Reads the answer of `GET /chat/media/<conversationId>`.
 * @param body - The parsed JSON body.
 * @returns The overview; entries of another shape are left out, an answer
 * without an overview is `null`.
 */
export function readMediaOverview(
  body: unknown,
): ConversationMediaOverview | null {
  if (!isRecord(body) || !isRecord(body.overview)) return null;
  const { overview } = body;
  if (!isText(overview.conversationId)) return null;
  return {
    conversationId: overview.conversationId,
    files: readList(overview.files, readFile),
    links: readList(overview.links, readLink),
    senders: readList(overview.senders, readSender),
  };
}

/** "Medien & Dateien" of a chat as the page loaded it. */
export interface LoadedMediaOverview {
  /** `null` until the first answer, and for a chat without a stored conversation. */
  readonly overview: ConversationMediaOverview | null;
  readonly isLoading: boolean;
  readonly isFailed: boolean;
}

/**
 * Loads "Medien & Dateien" of a chat from the server, which
 * answers only members.
 * @param conversationId - The stored conversation; `null` loads nothing.
 * @param reloadKey - Loads again whenever it changes, such as when the menu
 * opens or a message arrives; `null` loads nothing.
 */
export function useMediaOverview(
  conversationId: string | null,
  reloadKey: string | null,
): LoadedMediaOverview {
  const [overview, setOverview] = useState<ConversationMediaOverview | null>(
    null,
  );
  const [isLoading, setLoading] = useState(false);
  const [isFailed, setFailed] = useState(false);

  useEffect(() => {
    if (conversationId === null || reloadKey === null) return undefined;
    const controller = new AbortController();
    async function load(id: string): Promise<void> {
      setLoading(true);
      try {
        const response = await fetch(mediaOverviewUrl(id), {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        const read = response.ok
          ? readMediaOverview(await response.json())
          : null;
        setOverview(read);
        setFailed(read === null);
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        console.warn("The media of the chat could not be loaded.", error);
        setFailed(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load(conversationId);
    return () => controller.abort();
  }, [conversationId, reloadKey]);

  const isCurrent = overview?.conversationId === conversationId;
  return {
    overview: isCurrent ? overview : null,
    isLoading,
    isFailed,
  };
}
