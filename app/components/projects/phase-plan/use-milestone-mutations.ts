import { useRef } from "react";

import {
  buildSaveFormData,
  createPendingLinks,
  createPendingMilestone,
  withDraft,
} from "@/app/lib/phase-plan/plan-optimistic";

import type { OptimisticAction } from "@/app/lib/phase-plan/plan-optimistic";
import type {
  LinkOperations,
  PanelDraft,
  PendingSave,
  PlanSaveError,
} from "@/app/lib/phase-plan/plan-types";
import type { Milestone } from "@/definition/Task";
import type { Dispatch, RefObject, SetStateAction } from "react";

interface Submitter {
  readonly submit: (
    formData: FormData,
    options: { readonly method: "post" },
  ) => Promise<void>;
}

interface MutationsInput {
  readonly milestones: readonly Milestone[];
  readonly saveFetcher: Submitter;
  readonly deleteFetcher: Submitter;
  readonly pendingSave: RefObject<PendingSave | null>;
  readonly pendingDelete: RefObject<string | null>;
  readonly dispatch: Dispatch<OptimisticAction>;
  readonly setSaveError: Dispatch<SetStateAction<PlanSaveError | null>>;
}

/** The changes the milestone panel can make. */
export interface MilestoneMutations {
  readonly saveDraft: (
    draft: PanelDraft,
    milestoneId: string | null,
    linkOps: LinkOperations,
  ) => void;
  readonly deleteMilestone: (milestoneId: string) => void;
}

/**
 * Sends milestone saves and deletes and shows them before the server answers.
 *
 * @remarks
 * Every call records what it waits for, so the outcome hooks can revert the
 * optimistic change when the server refuses it.
 */
export function useMilestoneMutations(
  input: MutationsInput,
): MilestoneMutations {
  const {
    milestones,
    saveFetcher,
    deleteFetcher,
    pendingSave,
    pendingDelete,
    dispatch,
    setSaveError,
  } = input;
  const tempId = useRef(0);

  function saveNew(draft: PanelDraft): void {
    tempId.current += 1;

    const id = `pending-${tempId.current}`;

    pendingSave.current = { hadLinkOps: false, kind: "create", tempId: id };
    dispatch({
      milestone: createPendingMilestone(draft, id),
      type: "addPending",
    });
    void saveFetcher.submit(buildSaveFormData(draft, null, null), {
      method: "post",
    });
  }

  function saveExisting(
    server: Milestone,
    draft: PanelDraft,
    linkOps: LinkOperations,
  ): void {
    const hadLinkOps =
      linkOps.added.length > 0 || linkOps.removedIds.length > 0;

    pendingSave.current = { hadLinkOps, id: server.id, kind: "edit" };
    dispatch({
      milestone: withDraft(server, draft),
      milestoneId: server.id,
      type: "patch",
    });

    if (hadLinkOps) {
      tempId.current += 1;
      dispatch({
        links: createPendingLinks(server, linkOps.added, tempId.current),
        type: "addLinks",
      });
      dispatch({ linkIds: linkOps.removedIds, type: "removeLinks" });
    }

    void saveFetcher.submit(
      buildSaveFormData(draft, server.id, hadLinkOps ? linkOps : null),
      { method: "post" },
    );
  }

  function saveDraft(
    draft: PanelDraft,
    milestoneId: string | null,
    linkOps: LinkOperations,
  ): void {
    setSaveError(null);

    if (milestoneId === null) {
      saveNew(draft);
      return;
    }

    const server = milestones.find((milestone) => milestone.id === milestoneId);

    if (!server) {
      setSaveError("saveFailed");
      return;
    }

    saveExisting(server, draft, linkOps);
  }

  function deleteMilestone(milestoneId: string): void {
    setSaveError(null);
    pendingDelete.current = milestoneId;
    dispatch({ milestoneId, type: "remove" });

    const formData = new FormData();

    formData.set("intent", "delete-milestone");
    formData.set("milestoneId", milestoneId);
    void deleteFetcher.submit(formData, { method: "post" });
  }

  return { deleteMilestone, saveDraft };
}
