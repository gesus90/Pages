import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { showToast } from "@/app/components/ui/toast";
import { toastChatKey } from "@/app/components/ui/toast/toast-types";
import { CHAT_PAGE_ENDPOINT, isChatDirectory } from "@/app/lib/chat-directory";
import { backendRequestHeaders } from "@/app/lib/backend-request";
import { readRouteData } from "@/app/lib/local-state/route-data";

import {
  chatNotificationSnapshots,
  newChatMessages,
} from "./chat-notification-snapshot";

import type { NotificationChoices } from "@/definition/PicaMobileNotifications";

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

function shouldSuppressChatToast(
  snapshot: ReturnType<typeof chatNotificationSnapshots>[number],
  activity: ChatNotificationActivity,
): boolean {
  const { choices } = activity;
  if (snapshot.isMuted || !choices.receiveNotifications || !choices.chats) {
    return true;
  }
  if (activity.chatKeys.includes(toastChatKey(snapshot.chat))) {
    return true;
  }
  return (
    snapshot.conversationId !== null &&
    activity.conversationIds.includes(snapshot.conversationId)
  );
}

/** Agent session answers have no conversation event, so also read the directory at a slow interval. */
const CHAT_REFRESH_MILLISECONDS = 15_000;

/** Follows incoming chat messages across all pages, sharing the existing authorized directory endpoint. */
export function useChatNotifications(userId: string): () => void {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const requestRef = useRef<() => void>(() => undefined);
  const refresh = useCallback(() => requestRef.current(), []);
  useEffect(() => {
    const controller = new AbortController();
    let previous: Map<string, ReadonlySet<string>> | null = null;
    let isReading = false;
    let isDue = false;
    async function read(): Promise<void> {
      if (isReading) {
        isDue = true;
        return;
      }
      isReading = true;
      try {
        const [directory, activity] = await Promise.all([
          readRouteData({
            endpoint: CHAT_PAGE_ENDPOINT,
            signal: controller.signal,
            isPayload: isChatDirectory,
          }),
          readActivity(controller.signal),
        ]);
        if (controller.signal.aborted) return;
        const snapshots = chatNotificationSnapshots(directory);
        for (const snapshot of snapshots) {
          const incoming = previous ? newChatMessages(snapshot, previous) : [];
          const latest = incoming.at(-1);
          if (!latest || shouldSuppressChatToast(snapshot, activity)) {
            continue;
          }
          const query = new URLSearchParams({
            kind: snapshot.chat.kind,
            id: snapshot.chat.id,
          });
          const description =
            latest.content ||
            t(latest.voice ? "toast.voice" : "toast.attachment");
          showToast({
            type: "chat",
            chat: snapshot.chat,
            message: snapshot.name,
            avatarImageUrl: snapshot.avatarImageUrl,
            count: incoming.length,
            description: description.replace(/\s+/gu, " ").slice(0, 240),
            action: {
              label: t("toast.open"),
              onClick: () => {
                void navigate(`/chat?${query.toString()}`);
              },
            },
          });
        }
        previous = new Map(
          snapshots.map((snapshot) => [
            toastChatKey(snapshot.chat),
            new Set(snapshot.messages.map((message) => message.id)),
          ]),
        );
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
