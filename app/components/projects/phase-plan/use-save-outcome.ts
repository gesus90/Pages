import { useEffect } from "react";

import {
  getActionOutcome,
  toWorkingLinks,
} from "@/app/lib/phase-plan/plan-milestones";

import type { OptimisticAction } from "@/app/lib/phase-plan/plan-optimistic";
import type {
  PanelState,
  PendingSave,
  PlanSaveError,
  RevertToken,
  SavedToken,
} from "@/app/lib/phase-plan/plan-types";
import type { Milestone, MilestoneDependency } from "@/definition/Task";
import type { Dispatch, RefObject, SetStateAction } from "react";

interface SaveOutcomeInput {
  readonly fetcher: { readonly state: string; readonly data: unknown };
  readonly pendingSave: RefObject<PendingSave | null>;
  readonly milestones: readonly Milestone[];
  readonly milestoneLinks: readonly MilestoneDependency[];
  readonly dispatch: Dispatch<OptimisticAction>;
  readonly setPanel: Dispatch<SetStateAction<PanelState | null>>;
  readonly setSaveError: Dispatch<SetStateAction<PlanSaveError | null>>;
  readonly setSavedToken: Dispatch<SetStateAction<SavedToken | null>>;
  readonly setRevertToken: Dispatch<SetStateAction<RevertToken | null>>;
}

/**
 * Reacts to the answer of the background save.
 *
 * @remarks
 * A successful save closes the panel after dependency changes and otherwise
 * tells it that its draft is the new baseline. A failed save reverts the
 * optimistic change, hands the server links back to the panel and surfaces
 * an error.
 */
export function useSaveOutcome(input: SaveOutcomeInput): void {
  const {
    fetcher,
    pendingSave,
    milestones,
    milestoneLinks,
    dispatch,
    setPanel,
    setSaveError,
    setSavedToken,
    setRevertToken,
  } = input;

  useEffect(() => {
    const operation = pendingSave.current;
    const outcome = getActionOutcome(fetcher.data);

    if (operation === null || fetcher.state !== "idle" || outcome === null) {
      return;
    }

    pendingSave.current = null;

    if (outcome === "ok") {
      if (operation.hadLinkOps) {
        setPanel(null);
      } else {
        setSavedToken((current) => ({
          milestoneId: operation.kind === "edit" ? operation.id : null,
          token: (current?.token ?? 0) + 1,
        }));
      }

      return;
    }

    if (operation.kind === "edit") {
      dispatch({ milestoneId: operation.id, type: "unpatch" });
      dispatch({ milestoneId: operation.id, type: "dropPendingLinks" });
      setRevertToken((current) => ({
        links: toWorkingLinks(operation.id, milestoneLinks, milestones),
        milestoneId: operation.id,
        token: (current?.token ?? 0) + 1,
      }));
    } else {
      dispatch({ tempId: operation.tempId, type: "dropPending" });
      setRevertToken((current) => ({
        links: [],
        milestoneId: null,
        token: (current?.token ?? 0) + 1,
      }));
    }

    dispatch({ type: "restoreLinks" });
    setSaveError(operation.hadLinkOps ? "linkSaveFailed" : "saveFailed");
  }, [
    fetcher.data,
    fetcher.state,
    pendingSave,
    milestones,
    milestoneLinks,
    dispatch,
    setPanel,
    setSaveError,
    setSavedToken,
    setRevertToken,
  ]);
}
