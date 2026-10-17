import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";

const POLL_INTERVAL_MS = 30_000;
const MIN_CHECK_GAP_MS = 1_000;

/**
 * Refreshes stale permissions across devices; server checks remain authoritative immediately.
 * Polls only while the tab is visible, and checks once when it becomes visible or focused again.
 */
export function useAuthorizationRefresh(version: string): boolean {
  const [isOffline, setIsOffline] = useState(false);
  const revalidator = useRevalidator();
  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    let lastCheckAt = 0;
    async function check(): Promise<void> {
      lastCheckAt = Date.now();
      try {
        const response = await fetch("/account-version", {
          cache: "no-store",
          signal: controller.signal,
        });
        setIsOffline(false);
        if (!response.ok || response.redirected) {
          await revalidator.revalidate();
          return;
        }
        const result: unknown = await response.json();
        if (
          typeof result === "object" &&
          result !== null &&
          "version" in result &&
          result.version !== version
        ) {
          await revalidator.revalidate();
        }
      } catch {
        // Offline devices retry on the next interval or focus; no stale grant is trusted by the server.
        if (!controller.signal.aborted) setIsOffline(true);
      }
    }
    function checkIfVisible(): void {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastCheckAt < MIN_CHECK_GAP_MS) return;
      void check();
    }
    function startPolling(): void {
      timer ??= window.setInterval(checkIfVisible, POLL_INTERVAL_MS);
    }
    function stopPolling(): void {
      window.clearInterval(timer);
      timer = undefined;
    }
    function handleVisibilityChange(): void {
      if (document.visibilityState === "visible") {
        checkIfVisible();
        startPolling();
      } else {
        stopPolling();
      }
    }
    if (document.visibilityState === "visible") startPolling();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", checkIfVisible);
    return () => {
      controller.abort();
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", checkIfVisible);
    };
  }, [version, revalidator]);
  return isOffline;
}
