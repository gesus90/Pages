import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { showToast } from "@/app/components/ui/toast";
import { toastChatKey } from "@/app/components/ui/toast/toast-types";
import { CHAT_NOTIFICATIONS_ENDPOINT } from "@/app/lib/chat-directory";
import { backendRequestHeaders } from "@/app/lib/backend-request";
import { readRouteData } from "@/app/lib/local-state/route-data";

import { isPicaAuthor } from "@/definition/PicaMobileNotifications";

import {
  chatNotificationMarks,
  newChatArrival,
} from "./chat-notification-snapshot";

import type {
  ChatNotificationDigest,
  ChatNotificationEntry,
  ChatNotificationMessage,
} from "@/definition/ChatNotificationDigest";
import type { NotificationChoices } from "@/definition/PicaMobileNotifications";
import type { TFunction } from "i18next";
import type {
  ChatNotificationArrival,
  ChatNotificationMark,
} from "./chat-notification-snapshot";

interface ChatNotificationActivity {
  readonly chatKeys: readonly string[];
  readonly conversationIds: readonly string[];
  readonly choices: NotificationChoices;
}

function isChatNotificationActivity(
  value: unknown,
): value is ChatNotificationActivity {
  return (
    typeof value === "object" &&
    value !== null &&
    "chatKeys" in value &&
    Array.isArray(value.chatKeys) &&
    "conversationIds" in value &&
    Array.isArray(value.conversationIds) &&
    "choices" in value &&
    typeof value.choices === "object" &&
    value.choices !== null
  );
}

async function readActivity(
  signal: AbortSignal,
): Promise<ChatNotificationActivity> {
  const response = await fetch("/chat-page-api/presence", {
    headers: backendRequestHeaders({ Accept: "application/json" }),
    signal,
  });
  if (!response.ok) throw new Error("Chat notification presence unavailable.");
  const payload: unknown = await response.json();
  if (!isChatNotificationActivity(payload)) {
    throw new Error("Chat notification presence invalid.");
  }
  return payload;
}

/** Recognizes the digest returned by the notification endpoint. */
function isChatNotificationDigest(
  value: unknown,
): value is ChatNotificationDigest {
  return (
    typeof value === "object" &&
    value !== null &&
    "entries" in value &&
    Array.isArray(value.entries)
  );
}

function shouldSuppressChatToast(
  entry: ChatNotificationEntry,
  activity: ChatNotificationActivity,
): boolean {
  if (entry.isMuted || !activity.choices.receiveNotifications) {
    return true;
  }
  if (activity.chatKeys.includes(toastChatKey(entry.chat))) {
    return true;
  }
  return (
    entry.conversationId !== null &&
    activity.conversationIds.includes(entry.conversationId)
  );
}

/** Whether the message's kind is chosen: Pica's follow `pica`, all others `chats`. */
function isChosenChatMessage(
  message: ChatNotificationMessage,
  choices: NotificationChoices,
): boolean {
  return message.author !== null && isPicaAuthor(message.author)
    ? choices.pica
    : choices.chats;
}

/** Shows the pop-up of a chat with its newest arrived message. */
function showChatArrival(
  entry: ChatNotificationEntry,
  arrival: ChatNotificationArrival,
  page: {
    readonly t: TFunction;
    readonly navigate: (address: string) => Promise<void> | void;
  },
): void {
  const { message } = arrival;
  const query = new URLSearchParams({
    kind: entry.chat.kind,
    id: entry.chat.id,
  });
  showToast({
    type: "chat",
    chat: entry.chat,
    message: entry.name,
    avatarImageUrl: entry.avatarImageUrl,
    count: arrival.count,
    description:
      message.preview ||
      page.t(message.isVoice ? "toast.voice" : "toast.attachment"),
    action: {
      label: page.t("toast.open"),
      onClick: () => {
        void page.navigate(`/chat?${query.toString()}`);
      },
    },
  });
}

/** Agent session answers have no conversation event, so also read the digest at a slow interval. */
const CHAT_REFRESH_MILLISECONDS = 15_000;

/**
 * Follows incoming chat messages across all pages over the lean,
 * rights-checked notification endpoint, which reads the newest message of
 * each chat and no history.
 */
export function useChatNotifications(userId: string): () => void {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const requestRef = useRef<() => void>(() => undefined);
  const refresh = useCallback(() => requestRef.current(), []);
  useEffect(() => {
    const controller = new AbortController();
    let previous: Map<string, ChatNotificationMark> | null = null;
    let isReading = false;
    let isDue = false;
    async function read(): Promise<void> {
      if (isReading) {
        isDue = true;
        return;
      }
      isReading = true;
      try {
        const [digest, activity] = await Promise.all([
          readRouteData({
            endpoint: CHAT_NOTIFICATIONS_ENDPOINT,
            signal: controller.signal,
            isPayload: isChatNotificationDigest,
          }),
          readActivity(controller.signal),
        ]);
        if (controller.signal.aborted) return;
        for (const entry of digest.entries) {
          if (!previous || shouldSuppressChatToast(entry, activity)) continue;
          const arrival = newChatArrival(entry, previous);
          if (
            !arrival ||
            !isChosenChatMessage(arrival.message, activity.choices)
          )
            continue;
          showChatArrival(entry, arrival, { t, navigate });
        }
        previous = chatNotificationMarks(digest);
      } catch (error: unknown) {
        // Background reads can fail offline; the next live event or interval retries.
        if (!controller.signal.aborted)
          console.warn("Chat notifications could not refresh.", error);
      } finally {
        isReading = false;
        if (isDue && !controller.signal.aborted) {
          isDue = false;
          void read();
        }
      }
    }
    requestRef.current = () => {
      void read();
    };
    void read();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void read();
    }, CHAT_REFRESH_MILLISECONDS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      requestRef.current = () => undefined;
    };
  }, [userId, t, navigate]);
  return refresh;
}
