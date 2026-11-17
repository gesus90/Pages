import { useEffect, useEffectEvent } from "react";
import { useSearchParams } from "react-router";

/**
 * The run the address of the plan page names, such as the run a Jump called.
 * @returns The run identifier of the address, or `null` when it names none.
 */
export function usePlanRequestedRunId(): string | null {
  const [searchParams] = useSearchParams();
  return searchParams.get("runId");
}

/**
 * Shows the run the address names once the plan it belongs to is open.
 * @param runId - The run the address names, or `null`.
 * @param planId - The plan that is open, if any.
 * @param select - Shows a run of the open plan by its identifier.
 * @remarks
 * It selects only when the address or the open plan changes, so choosing
 * another run in the history is never undone.
 */
export function useOpenRequestedRun(
  runId: string | null,
  planId: string | undefined,
  select: (id: string, mode: "follow" | "history") => void,
): void {
  const open = useEffectEvent((id: string): void => select(id, "history"));
  useEffect(() => {
    if (runId && planId) open(runId);
  }, [runId, planId]);
}
