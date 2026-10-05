import { useState } from "react";
import { useSubmit } from "react-router";

import { parseLinkType } from "@/app/components/tasks/task-links/link-type";
import { WORK_ITEM_LINK_TYPE } from "@/definition/Task";

import type { WorkItemLink, WorkItemLinkType } from "@/definition/Task";

/** The draft of a new link and the actions that change the links. */
export interface TaskLinkActions {
  readonly linkType: WorkItemLinkType;
  readonly targetKey: string;
  readonly setTargetKey: (targetKey: string) => void;
  readonly changeLinkType: (linkType: string) => void;
  readonly addLink: () => void;
  readonly cancelAdd: () => void;
  readonly removeLink: (link: WorkItemLink) => void;
}

/**
 * Keeps the draft of a new link and submits link changes of a ticket.
 *
 * @param workItemId - The ticket new links start from.
 * @param onAddFormOpenChange - Closes the add form after adding or cancelling.
 */
export function useTaskLinkActions(
  workItemId: string,
  onAddFormOpenChange: ((isOpen: boolean) => void) | undefined,
): TaskLinkActions {
  const submit = useSubmit();
  const [linkType, setLinkType] = useState<WorkItemLinkType>(
    WORK_ITEM_LINK_TYPE.RELATES_TO,
  );
  const [targetKey, setTargetKey] = useState("");

  function addLink(): void {
    void submit(
      { intent: "link-add", linkType, targetKey, workItemId },
      { method: "post" },
    );
    setTargetKey("");
    onAddFormOpenChange?.(false);
  }

  function cancelAdd(): void {
    setTargetKey("");
    onAddFormOpenChange?.(false);
  }

  function changeLinkType(nextLinkType: string): void {
    setLinkType(parseLinkType(nextLinkType));
  }

  function removeLink(link: WorkItemLink): void {
    void submit(
      { intent: "link-remove", linkId: link.id, workItemId },
      { method: "post" },
    );
  }

  return {
    addLink,
    cancelAdd,
    changeLinkType,
    linkType,
    removeLink,
    setTargetKey,
    targetKey,
  };
}
