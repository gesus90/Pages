import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { showToast } from "@/app/components/ui/toast";
import { toastChatKey } from "@/app/components/ui/toast/toast-types";
import { CHAT_PAGE_ENDPOINT, isChatDirectory } from "@/app/lib/chat-directory";
import { readRouteData } from "@/app/lib/local-state/route-data";

import {
  chatNotificationSnapshots,
  newChatMessages,
} from "./chat-notification-snapshot";

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
        const directory = await readRouteData({
          endpoint: CHAT_PAGE_ENDPOINT,
          signal: controller.signal,
          isPayload: isChatDirectory,
        });
        if (controller.signal.aborted) return;
        const snapshots = chatNotificationSnapshots(directory);
        for (const snapshot of snapshots) {
          const incoming = previous ? newChatMessages(snapshot, previous) : [];
          const latest = incoming.at(-1);
          if (!latest || snapshot.isMuted) continue;
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
