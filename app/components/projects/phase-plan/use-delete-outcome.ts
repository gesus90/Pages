import { useEffect } from "react";

import {
  getActionOutcome,
  panelMilestoneIdFor,
} from "@/app/lib/phase-plan/plan-milestones";

import type { OptimisticAction } from "@/app/lib/phase-plan/plan-optimistic";
import type {
  PanelState,
  PlanSaveError,
} from "@/app/lib/phase-plan/plan-types";
import type { Dispatch, RefObject, SetStateAction } from "react";

interface DeleteOutcomeInput {
  readonly fetcher: { readonly state: string; readonly data: unknown };
  readonly pendingDelete: RefObject<string | null>;
  readonly dispatch: Dispatch<OptimisticAction>;
  readonly setPanel: Dispatch<SetStateAction<PanelState | null>>;
  readonly setSaveError: Dispatch<SetStateAction<PlanSaveError | null>>;
}

/**
 * Reacts to the answer of the background delete.
 *
 * @remarks
 * A failed delete restores the milestone and keeps the panel open to show the
 * error; a successful one closes the panel of the deleted milestone.
 */
export function useDeleteOutcome(input: DeleteOutcomeInput): void {
  const { fetcher, pendingDelete, dispatch, setPanel, setSaveError } = input;

  useEffect(() => {
    const deletedId = pendingDelete.current;
    const outcome = getActionOutcome(fetcher.data);

    if (deletedId === null || fetcher.state !== "idle" || outcome === null) {
      return;
    }

    pendingDelete.current = null;

    if (outcome === "ok") {
      setPanel((current) =>
        panelMilestoneIdFor(current) === deletedId ? null : current,
      );
      return;
    }

    dispatch({ milestoneId: deletedId, type: "restore" });
    setSaveError("saveFailed");
  }, [
    fetcher.data,
    fetcher.state,
    pendingDelete,
    dispatch,
    setPanel,
    setSaveError,
  ]);
}
