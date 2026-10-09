import { useEffect, useRef } from "react";
import { useBlocker } from "react-router";

import type { WikiSaveStatus } from "@/app/components/wiki/use-wiki-draft";

/** What the guard needs to know about the draft. */
interface SaveGuard {
  readonly isClean: boolean;
  readonly status: WikiSaveStatus;
  readonly saveNow: () => void;
}

/**
 * Saves the draft before the person leaves the page inside Pages, and keeps
 * them on the page when it cannot be saved.
 *
 * @param draft - Status of the draft and the function that saves it now.
 * @returns Whether a navigation waits for the save.
 *
 * @remarks
 * Navigating right after typing used to drop the last characters, because
 * the autosave waits for a pause (A6 limitation). Now the navigation waits
 * until the draft is saved. A conflict, an error or a missing title stops
 * it, so nothing typed is lost. Closing the tab still asks the browser.
 */
export function useSaveBeforeLeave(draft: SaveGuard): boolean {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !draft.isClean && currentLocation.pathname !== nextLocation.pathname,
  );
  const isBlocked = blocker.state === "blocked";
  const { isClean, status, saveNow } = draft;
  // A blocked navigation goes on exactly once; React Router refuses a
  // second `proceed` while the first one runs.
  const hasProceeded = useRef(false);

  useEffect(() => {
    if (!isBlocked) {
      hasProceeded.current = false;

      return;
    }

    if ((status === "saved" || isClean) && !hasProceeded.current) {
      hasProceeded.current = true;
      blocker.proceed?.();
    } else if (status === "unsaved") {
      saveNow();
    } else if (status !== "saving" && status !== "saved") {
      blocker.reset?.();
    }
  }, [blocker, isBlocked, isClean, status, saveNow]);

  useEffect(() => {
    if (isClean) {
      return undefined;
    }

    const warn = (event: BeforeUnloadEvent): void => event.preventDefault();

    window.addEventListener("beforeunload", warn);

    return () => window.removeEventListener("beforeunload", warn);
  }, [isClean]);

  return isBlocked;
}
