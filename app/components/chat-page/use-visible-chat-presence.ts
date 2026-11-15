import { useEffect, useRef } from "react";

import { toastChatKey } from "@/app/components/ui/toast/toast-types";
import { backendRequestHeaders } from "@/app/lib/backend-request";

import type { VirtualChatSelection } from "@/definition/VirtualChat";

const HEARTBEAT_MILLISECONDS = 20_000;

/** Renews the open chat while this document is visible, independently of window focus. */
export function useVisibleChatPresence(
  selection: VirtualChatSelection | null,
  conversationId: string | null,
): void {
  const connectionId = useRef<string | null>(null);
  const selectedChatKey = selection ? toastChatKey(selection) : null;
  useEffect(() => {
    connectionId.current ??= crypto.randomUUID();
    const id = connectionId.current;
    function report(): void {
      const isVisible = document.visibilityState === "visible";
      const chatKey = isVisible ? selectedChatKey : null;
      void fetch("/chat-page-api/presence", {
        method: "POST",
        headers: backendRequestHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          connectionId: id,
          chatKey,
          conversationId: chatKey === null ? null : conversationId,
        }),
        keepalive: true,
      }).catch(() => undefined);
    }
    report();
    const timer = window.setInterval(() => report(), HEARTBEAT_MILLISECONDS);
    const onVisibilityChange = (): void => report();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [selectedChatKey, conversationId]);
  useEffect(
    () => () => {
      if (connectionId.current === null) return;
      void fetch("/chat-page-api/presence", {
        method: "POST",
        headers: backendRequestHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          connectionId: connectionId.current,
          chatKey: null,
          conversationId: null,
        }),
        keepalive: true,
      }).catch(() => undefined);
    },
    [],
  );
}
