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

interface ArchiveOutcomeInput {
  readonly fetcher: { readonly state: string; readonly data: unknown };
  readonly pendingArchive: RefObject<string | null>;
  readonly dispatch: Dispatch<OptimisticAction>;
  readonly setPanel: Dispatch<SetStateAction<PanelState | null>>;
  readonly setSaveError: Dispatch<SetStateAction<PlanSaveError | null>>;
}

/**
 * Reacts to the answer of the background archive.
 *
 * @remarks
 * A failed archive restores the milestone and keeps the panel open to show the
 * error; a successful one closes the panel of the archived milestone.
 */
export function useArchiveOutcome(input: ArchiveOutcomeInput): void {
  const { fetcher, pendingArchive, dispatch, setPanel, setSaveError } = input;

  useEffect(() => {
    const archivedId = pendingArchive.current;
    const outcome = getActionOutcome(fetcher.data);

    if (archivedId === null || fetcher.state !== "idle" || outcome === null) {
      return;
    }

    pendingArchive.current = null;

    if (outcome === "ok") {
      setPanel((current) =>
        panelMilestoneIdFor(current) === archivedId ? null : current,
      );
      return;
    }

    dispatch({ milestoneId: archivedId, type: "restore" });
    setSaveError("saveFailed");
  }, [
    fetcher.data,
    fetcher.state,
    pendingArchive,
    dispatch,
    setPanel,
    setSaveError,
  ]);
}
