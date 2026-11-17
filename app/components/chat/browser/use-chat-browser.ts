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
  /** Whether the person folded the row of a browser; it holds until the browser ends. */
  isCollapsed(browserId: string): boolean;
  setCollapsed(browserId: string, isCollapsed: boolean): void;
}

const EMPTY: PicaBrowserOverview = { browsers: [], savedSessions: [] };

type OverviewState = readonly [
  PicaBrowserOverview,
  React.Dispatch<React.SetStateAction<PicaBrowserOverview>>,
];

/**
 * Reads the browsers of the administrator again and again while the page is open.
 * @param isOpen - Whether the page is open; a closed one reads nothing.
 * @remarks
 * A person who is no administrator gets a refusal once and no further reads.
 */
function useBrowserOverview(isOpen: boolean): OverviewState {
  const [overview, setOverview] = useState<PicaBrowserOverview>(EMPTY);
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
  }, [isOpen, isAvailable, hasBrowsers, setOverview]);

  return [overview, setOverview] as const;
}

/**
 * Follows the operator browsers of the signed-in administrator while the page is open.
 * @param isOpen - Whether the page is open; a closed one reads nothing.
 */
export function useChatBrowser(isOpen: boolean): ChatBrowsers {
  const [overview, setOverview] = useBrowserOverview(isOpen);
  const [error, setError] = useState<string | null>(null);
  // Browser IDs are never reused, so an ended browser leaves only its ID here.
  const [collapsed, setCollapsedIds] = useState<ReadonlySet<string>>(new Set());

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

  function setCollapsed(browserId: string, isCollapsed: boolean): void {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (isCollapsed) next.add(browserId);
      else next.delete(browserId);
      return next;
    });
  }

  return {
    browsers: overview.browsers,
    savedSessions: overview.savedSessions,
    error,
    command,
    isCollapsed: (browserId) => collapsed.has(browserId),
    setCollapsed,
  };
}
