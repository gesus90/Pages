import { useEffect, useState } from "react";

/** Formats elapsed wall time without wrapping after an hour. */
export function formatChatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, "0");
  if (minutes < 60) return `${String(minutes).padStart(2, "0")}:${remainder}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${remainder}`;
}

/** Reads wall time from the request's stable start; hidden panels need no interval. */
export function useChatElapsed(startedAt: number, isOpen: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!isOpen) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt, isOpen]);
  return Number.isFinite(startedAt)
    ? Math.max(0, Math.floor((now - startedAt) / 1000))
    : 0;
}
