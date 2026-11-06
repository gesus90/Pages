import { useEffect } from "react";

/**
 * Registers the service worker that keeps the static app available offline (PAGE-235).
 *
 * @remarks
 * Only the production build has a worker. Browsers allow one only in a
 * secure context: over HTTPS or on `localhost`.
 */
export function useServiceWorker(): void {
  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
      console.warn("Pages could not keep the app for offline use.", error);
    });
  }, []);
}
