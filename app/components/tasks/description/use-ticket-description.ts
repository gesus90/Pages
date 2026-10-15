import { useEffect, useState } from "react";

import { useDraftStores } from "@/app/components/common/draft-provider";

import type { DraftEntry } from "@/app/lib/drafts/draft-queue";
import type { DescriptionContent } from "@/definition/BackgroundSave";
import type { WorkItemDetail } from "@/definition/Task";

/** How far the description editing got. */
export type DescriptionStatus =
  "viewing" | "editing" | "saving" | "saved" | "failed" | "conflict";

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

/** Keeps the explicit Save action asynchronous and retains drafts between views. */
export function useTicketDescription(
  ticket: Pick<WorkItemDetail, "id" | "key" | "description" | "updatedAt">,
): TicketDescriptionState {
  const { descriptions } = useDraftStores();
  const entry = descriptions.open({
    id: ticket.id,
    href: `/tasks/${ticket.key}`,
    label: ticket.key,
    saved: { description: ticket.description, updatedAt: ticket.updatedAt },
  });
  const [isEditing, setIsEditing] = useState(false);
  useEffect(() => {
    if (
      !isEditing &&
      Date.parse(ticket.updatedAt) > Date.parse(entry.base.updatedAt)
    ) {
      descriptions.adopt(ticket.id, {
        description: ticket.description,
        updatedAt: ticket.updatedAt,
      });
    }
  }, [
    descriptions,
    ticket.id,
    ticket.description,
    ticket.updatedAt,
    entry.base.updatedAt,
    isEditing,
  ]);
  const needsAttention = entry.hasChanges && !entry.isSaving;
  const status = descriptionStatus(entry, isEditing);

  return {
    base: entry.base.description,
    draft: entry.draft.description,
    errorCode: entry.error ?? "",
    isDirty: entry.hasChanges || entry.isSaving,
    isEditing: isEditing || needsAttention || entry.current !== undefined,
    status,
    change: (description) =>
      descriptions.change(ticket.id, { ...entry.draft, description }),
    save: (overwrite = false) => {
      if (overwrite && entry.current) descriptions.resolve(ticket.id, "mine");
      else descriptions.save(ticket.id);
      setIsEditing(false);
    },
    cancel: () => {
      if (entry.current) descriptions.resolve(ticket.id, "theirs");
      else {
        descriptions.change(ticket.id, entry.base);
        if (entry.hasUnconfirmedWrite) descriptions.save(ticket.id);
      }
      setIsEditing(false);
    },
    startEditing: () => setIsEditing(true),
    takeLatest: () => {
      const latest = entry.current ?? entry.base;
      descriptions.resolve(ticket.id, "theirs");
      setIsEditing(true);
      return latest.description;
    },
  };
}

function descriptionStatus(
  entry: DraftEntry<DescriptionContent>,
  isEditing: boolean,
): DescriptionStatus {
  if (entry.current) return "conflict";
  if (entry.error) return "failed";
  if (entry.isSaving) return "saving";
  if (isEditing || entry.hasChanges) return "editing";
  return entry.hasEdited ? "saved" : "viewing";
}
