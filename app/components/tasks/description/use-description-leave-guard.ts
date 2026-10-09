import { useEffect, useState } from "react";
import { useBlocker } from "react-router";

import type { TicketDescriptionState } from "./use-ticket-description";

/** The question shown when a person leaves an unsaved description. */
export interface DescriptionLeaveGuard {
  readonly isAsking: boolean;
  /** Stays on the ticket with the draft. */
  readonly stay: () => void;
  /** Drops the draft and leaves. */
  readonly discard: () => void;
  /** Saves the draft and leaves once it is saved. */
  readonly saveAndLeave: () => void;
}

/**
 * Asks before a person leaves the ticket, closes the panel or the tab while
 * the description has unsaved changes (A8.2-E05).
 *
 * @param description - The description being edited.
 * @returns The state of the question and its answers.
 *
 * @remarks
 * Saving is explicit for tickets, so leaving neither saves behind the
 * person's back nor drops the draft silently. A save that fails or meets a
 * conflict keeps the person on the ticket with the draft.
 */
export function useDescriptionLeaveGuard(
  description: TicketDescriptionState,
): DescriptionLeaveGuard {
  const { isDirty, status } = description;
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirty &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
  );
  const [isLeavingAfterSave, setIsLeavingAfterSave] = useState(false);
  const isBlocked = blocker.state === "blocked";

  useEffect(() => {
    if (!isLeavingAfterSave || !isBlocked) {
      return;
    }

    if (status === "saved") {
      setIsLeavingAfterSave(false);
      blocker.proceed?.();
    } else if (status === "failed" || status === "conflict") {
      setIsLeavingAfterSave(false);
      blocker.reset?.();
    }
  }, [blocker, isBlocked, isLeavingAfterSave, status]);

  useEffect(() => {
    if (!isDirty) {
      return undefined;
    }

    const warn = (event: BeforeUnloadEvent): void => event.preventDefault();

    window.addEventListener("beforeunload", warn);

    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

  return {
    discard: () => {
      description.cancel();
      blocker.proceed?.();
    },
    isAsking: isBlocked && !isLeavingAfterSave,
    saveAndLeave: () => {
      setIsLeavingAfterSave(true);
      description.save();
    },
    stay: () => blocker.reset?.(),
  };
}
