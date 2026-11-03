import { useEffect, useState } from "react";

import {
  PicaBrowserClientError,
  fetchPicaBrowsers,
  sendPicaBrowserCommand,
} from "@/app/lib/pica-browser-client";

import type {
  PicaBrowserCommand,
  PicaBrowserOverview,
  PicaBrowserView,
} from "@/definition/PicaBrowser";

/** Seconds between two reads while a browser is open, and while none is. */
const BUSY_INTERVAL_MS = 1200;
const IDLE_INTERVAL_MS = 4000;

/** The operator browsers of the administrator, as the chat follows them. */
export interface ChatBrowsers {
  readonly browsers: readonly PicaBrowserView[];
  readonly savedSessions: PicaBrowserOverview["savedSessions"];
  /** The stable code of the last failed control, shown until the next one succeeds. */
  readonly error: string | null;
  /** Gives a control to one browser; the answer replaces its view at once. */
  command(browserId: string, command: PicaBrowserCommand): Promise<void>;
}

const EMPTY: PicaBrowserOverview = { browsers: [], savedSessions: [] };

/**
 * Follows the operator browsers of the signed-in administrator while the panel is open.
 *
 * @param isOpen - Whether the chat panel is open; a closed panel reads nothing.
 *
 * @remarks
 * A person who is no administrator gets a refusal once and no further reads.
 */
export function useChatBrowser(isOpen: boolean): ChatBrowsers {
  const [overview, setOverview] = useState<PicaBrowserOverview>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [isAvailable, setIsAvailable] = useState(true);
  const hasBrowsers = overview.browsers.length > 0;

  useEffect(() => {
    if (!isOpen || !isAvailable) return undefined;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function read(): Promise<void> {
      try {
        const fresh = await fetchPicaBrowsers(controller.signal);
        setOverview(fresh);
      } catch (failure: unknown) {
        if (controller.signal.aborted) return;
        if (
          failure instanceof PicaBrowserClientError &&
          (failure.code === "ADMIN_REQUIRED" ||
            failure.code === "OS_RIGHTS_DENIED")
        ) {
          setIsAvailable(false);
          return;
        }
      }
      timer = setTimeout(
        () => void read(),
        hasBrowsers ? BUSY_INTERVAL_MS : IDLE_INTERVAL_MS,
      );
    }
    void read();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [isOpen, isAvailable, hasBrowsers]);

  async function command(
    browserId: string,
    next: PicaBrowserCommand,
  ): Promise<void> {
    try {
      const view = await sendPicaBrowserCommand(browserId, next);
      setError(null);
      setOverview((current) => ({
        ...current,
        browsers: current.browsers.map((entry) =>
          entry.browserId === view.browserId ? view : entry,
        ),
      }));
    } catch (failure: unknown) {
      setError(
        failure instanceof PicaBrowserClientError
          ? failure.code
          : "BROWSER_FAILED",
      );
    }
  }

  return {
    browsers: overview.browsers,
    savedSessions: overview.savedSessions,
    error,
    command,
  };
}
