import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";

/** Refreshes stale permissions across devices; server checks remain authoritative immediately. */
export function useAuthorizationRefresh(version: string): boolean {
  const [isOffline, setIsOffline] = useState(false);
  const revalidator = useRevalidator();
  useEffect(() => {
    const controller = new AbortController();
    async function check(): Promise<void> {
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
    function handleFocus(): void {
      void check();
    }
    const interval = window.setInterval(handleFocus, 5000);
    window.addEventListener("focus", handleFocus);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
    };
  }, [version, revalidator]);
  return isOffline;
}
