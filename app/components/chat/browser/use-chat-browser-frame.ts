import { useEffect, useState } from "react";

import { fetchPicaBrowserFrame } from "@/app/lib/pica-browser-client";

/** Milliseconds between two pictures of a browser that is watched. */
const FRAME_INTERVAL_MS = 900;

/**
 * Follows the live picture of one operator browser.
 *
 * @param browserId - The browser.
 * @param isWatching - Whether the picture is shown; a hidden one fetches nothing.
 * @returns The address of the newest picture, or `null` before the first one.
 *
 * @remarks
 * Each picture is fetched, shown and then its object URL is released, so a
 * long watch holds one image in memory.
 */
export function useChatBrowserFrame(
  browserId: string,
  isWatching: boolean,
): string | null {
  const [source, setSource] = useState<string | null>(null);

  useEffect(() => {
    if (!isWatching) return undefined;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let shown: string | null = null;
    async function refresh(): Promise<void> {
      try {
        const frame = await fetchPicaBrowserFrame(browserId, controller.signal);
        if (frame && !controller.signal.aborted) {
          if (shown) URL.revokeObjectURL(shown);
          shown = frame.url;
          setSource(frame.url);
        } else if (frame) {
          URL.revokeObjectURL(frame.url);
        }
      } catch {
        // The next round asks again; a closed browser answers with an error until its view disappears.
      }
      if (!controller.signal.aborted)
        timer = setTimeout(() => void refresh(), FRAME_INTERVAL_MS);
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
      if (shown) URL.revokeObjectURL(shown);
    };
  }, [browserId, isWatching]);

  return source;
}
