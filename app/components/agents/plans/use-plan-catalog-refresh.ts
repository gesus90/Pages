import { useEffect } from "react";
import { useRevalidator } from "react-router";

/** An authorized loader's baseline for conditional context refresh, without another catalog payload. */
export interface PlanCatalogRefresh {
  readonly url: string;
  readonly etag: string;
}

/** Refreshes changed registry and runner facts while preserving the editor's unsaved draft. */
export function usePlanCatalogRefresh(input?: PlanCatalogRefresh): void {
  const { revalidate, state } = useRevalidator();
  useEffect(() => {
    if (state !== "idle") return;
    const controller = new AbortController();
    let isPending = false;
    async function refresh(): Promise<void> {
      if (document.visibilityState !== "visible" || isPending || !input) return;
      isPending = true;
      try {
        const response = await fetch(input.url, {
          cache: "no-store",
          signal: controller.signal,
          headers: { "If-None-Match": input.etag },
        });
        if (response.status !== 304 && !controller.signal.aborted)
          void revalidate();
      } catch {
        if (!controller.signal.aborted) void revalidate();
      } finally {
        isPending = false;
      }
    }
    function focus(): void {
      if (document.visibilityState === "visible") void revalidate();
    }
    const timer = window.setInterval(() => {
      void refresh();
    }, 15_000);
    window.addEventListener("focus", focus);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [input, revalidate, state]);
}
