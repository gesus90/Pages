import { useEffect, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";

import type { WorkItemDetail } from "@/definition/Task";

/** How far the description editing got. */
export type DescriptionStatus =
  "viewing" | "editing" | "saving" | "saved" | "failed" | "conflict";

/** The outcome of a ticket action as the action route answers it. */
interface ActionAnswer {
  readonly ok: boolean;
  readonly error?: string;
}

/** The description of a ticket while a person reads or edits it. */
export interface TicketDescriptionState {
  readonly status: DescriptionStatus;
  readonly isEditing: boolean;
  /** The markdown in the editor. */
  readonly draft: string;
  /** The saved description the draft started from. */
  readonly base: string;
  readonly isDirty: boolean;
  /** Reason of the last failure as a key below `tasks.error`; empty without one. */
  readonly errorCode: string;
  readonly startEditing: () => void;
  readonly change: (markdown: string) => void;
  /** Saves the draft; `overwrite` takes the newest saved text as base. */
  readonly save: (overwrite?: boolean) => void;
  /** Leaves the editor and keeps the saved description, without saving. */
  readonly cancel: () => void;
  /** Gives up the draft for the newest saved description. */
  readonly takeLatest: () => string;
}

function isActionAnswer(value: unknown): value is ActionAnswer {
  return typeof value === "object" && value !== null && "ok" in value;
}

function readFailure(answer: ActionAnswer): DescriptionStatus {
  return answer.error === "descriptionConflict" ? "conflict" : "failed";
}

/**
 * Keeps the description of a ticket while it is read and edited (A8.2-E05):
 * explicit saving with the text it started from, cancelling without a save,
 * and a conflict when someone else saved in between.
 *
 * @param ticket - The ticket as the page loaded it last.
 * @returns The state and the actions of the description.
 */
export function useTicketDescription(
  ticket: Pick<WorkItemDetail, "id" | "description">,
): TicketDescriptionState {
  const fetcher = useFetcher<unknown>();
  const { revalidate } = useRevalidator();
  const [status, setStatus] = useState<DescriptionStatus>("viewing");
  const [draft, setDraft] = useState(ticket.description);
  const [base, setBase] = useState(ticket.description);
  const [errorCode, setErrorCode] = useState("");
  const answer = fetcher.state === "idle" ? fetcher.data : undefined;
  const isEditing = status !== "viewing" && status !== "saved";

  useEffect(() => {
    if (!isActionAnswer(answer)) {
      return;
    }

    if (answer.ok) {
      setStatus("saved");
      setErrorCode("");

      return;
    }

    setErrorCode(answer.error ?? "invalidInput");
    const failureStatus = readFailure(answer);

    if (answer.error === "descriptionConflict") {
      // HTTP 400 skips the router's automatic reload; the conflict actions
      // need the latest saved text while the person's draft stays intact.
      async function reloadLatest(): Promise<void> {
        await revalidate();
        setStatus(failureStatus);
      }

      void reloadLatest();

      return;
    }

    setStatus(failureStatus);
  }, [answer, revalidate]);

  function save(overwrite = false): void {
    const baseDescription = overwrite ? ticket.description : base;

    setStatus("saving");
    setErrorCode("");
    setBase(baseDescription);
    void fetcher.submit(
      {
        baseDescription,
        description: draft,
        id: ticket.id,
        intent: "update-description",
      },
      { action: "/aufgaben", method: "post" },
    );
  }

  return {
    base,
    cancel: () => {
      setDraft(ticket.description);
      setBase(ticket.description);
      setStatus("viewing");
      setErrorCode("");
    },
    change: setDraft,
    draft,
    errorCode,
    isDirty: isEditing && draft.trim() !== base.trim(),
    isEditing,
    save,
    startEditing: () => {
      setDraft(ticket.description);
      setBase(ticket.description);
      setStatus("editing");
    },
    status,
    takeLatest: () => {
      setDraft(ticket.description);
      setBase(ticket.description);
      setStatus("editing");
      setErrorCode("");

      return ticket.description;
    },
  };
}
