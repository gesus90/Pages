import { useEffect } from "react";
import { useRevalidator } from "react-router";

/** Refreshes registry and runner facts while preserving the editor's unsaved draft. */
export function usePlanCatalogRefresh(): void {
  const { revalidate, state } = useRevalidator();
  useEffect(() => {
    if (state !== "idle") return;
    function refresh(): void {
      if (document.visibilityState === "visible") void revalidate();
    }
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [revalidate, state]);
}
