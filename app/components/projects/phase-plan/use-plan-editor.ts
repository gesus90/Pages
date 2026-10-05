import { useEffect, useReducer, useRef, useState } from "react";
import { useFetcher } from "react-router";

import { useDeleteOutcome } from "@/app/components/projects/phase-plan/use-delete-outcome";
import { useMilestoneMutations } from "@/app/components/projects/phase-plan/use-milestone-mutations";
import { useSaveOutcome } from "@/app/components/projects/phase-plan/use-save-outcome";
import { panelMilestoneIdFor } from "@/app/lib/phase-plan/plan-milestones";
import {
  EMPTY_OPTIMISTIC_STATE,
  applyOptimisticState,
  optimisticReducer,
} from "@/app/lib/phase-plan/plan-optimistic";

import type { EffectiveData } from "@/app/lib/phase-plan/plan-optimistic";
import type {
  LinkOperations,
  PanelDraft,
  PanelState,
  PendingSave,
  PlanSaveError,
  PreviewPatch,
  RevertToken,
  SavedToken,
} from "@/app/lib/phase-plan/plan-types";
import type { Milestone, MilestoneDependency } from "@/definition/Task";

/** What the plan needs to show and edit milestones in the background. */
export interface PlanEditor extends EffectiveData {
  readonly panel: PanelState | null;
  readonly saveError: PlanSaveError | null;
  readonly savedToken: SavedToken | null;
  readonly revertToken: RevertToken | null;
  readonly isSaving: boolean;
  readonly isDeleting: boolean;
  readonly openCreate: () => void;
  readonly openMilestone: (milestone: Milestone) => void;
  readonly closePanel: () => void;
  readonly saveDraft: (
    draft: PanelDraft,
    milestoneId: string | null,
    linkOps: LinkOperations,
  ) => void;
  readonly deleteMilestone: (milestoneId: string) => void;
  readonly previewPatch: (
    milestoneId: string | null,
    patch: PreviewPatch | null,
  ) => void;
}

/**
 * Owns the milestone panel and applies saves and deletes optimistically.
 *
 * @remarks
 * Saves go out through background requests, so the timeline never reloads:
 * the change shows immediately and is reverted with an error when the server
 * refuses it. Once the loader data arrives, every local change is dropped,
 * because the server data always wins.
 *
 * @param milestones - Milestones from the loader.
 * @param milestoneLinks - Dependencies from the loader.
 */
export function usePlanEditor(
  milestones: readonly Milestone[],
  milestoneLinks: readonly MilestoneDependency[],
): PlanEditor {
  const saveFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const [state, dispatch] = useReducer(
    optimisticReducer,
    EMPTY_OPTIMISTIC_STATE,
  );
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [saveError, setSaveError] = useState<PlanSaveError | null>(null);
  const [savedToken, setSavedToken] = useState<SavedToken | null>(null);
  const [revertToken, setRevertToken] = useState<RevertToken | null>(null);
  const pendingSave = useRef<PendingSave | null>(null);
  const pendingDelete = useRef<string | null>(null);

  useEffect(() => {
    dispatch({ type: "reset" });
  }, [milestones, milestoneLinks]);

  useSaveOutcome({
    dispatch,
    fetcher: saveFetcher,
    milestoneLinks,
    milestones,
    pendingSave,
    setPanel,
    setRevertToken,
    setSaveError,
    setSavedToken,
  });
  useDeleteOutcome({
    dispatch,
    fetcher: deleteFetcher,
    pendingDelete,
    setPanel,
    setSaveError,
  });

  const { saveDraft, deleteMilestone } = useMilestoneMutations({
    dispatch,
    deleteFetcher,
    milestones,
    pendingDelete,
    pendingSave,
    saveFetcher,
    setSaveError,
  });

  function previewPatch(
    milestoneId: string | null,
    patch: PreviewPatch | null,
  ): void {
    const operation = pendingSave.current;

    if (
      milestoneId === null ||
      (operation !== null &&
        operation.kind === "edit" &&
        operation.id === milestoneId)
    ) {
      return;
    }

    if (patch === null) {
      dispatch({ milestoneId, type: "unpatch" });
      return;
    }

    const server = milestones.find((milestone) => milestone.id === milestoneId);

    if (server) {
      dispatch({
        milestone: { ...server, ...patch },
        milestoneId,
        type: "patch",
      });
    }
  }

  function closePanel(): void {
    previewPatch(panelMilestoneIdFor(panel), null);
    setPanel(null);
    setSaveError(null);
  }

  function openCreate(): void {
    setPanel({ mode: "create" });
  }

  function openMilestone(milestone: Milestone): void {
    setPanel({ milestone, mode: "edit" });
  }

  return {
    ...applyOptimisticState(milestones, milestoneLinks, state),
    closePanel,
    deleteMilestone,
    isDeleting: deleteFetcher.state !== "idle",
    isSaving: saveFetcher.state !== "idle",
    openCreate,
    openMilestone,
    panel,
    previewPatch,
    revertToken,
    saveDraft,
    saveError,
    savedToken,
  };
}
