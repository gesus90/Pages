import { isActivePlanRun } from "@/definition/AgentPlanRunState";
import { logEvent } from "@/backend/logging/Logger";

import type { AgentPlanRun } from "@/definition/AgentPlan";

interface RetirementDependencies {
  readonly readRun: () => Promise<Pick<AgentPlanRun, "status"> | null>;
  /** Uses the process lifecycle's bounded native closeout and shutdown tasks. */
  readonly retire: () => Promise<void>;
}

/** Retires a native owner even when a failed closeout prevents the server's normal release. */
export function watchLocalOwnerRetirement(
  dependencies: RetirementDependencies,
): () => void {
  let isChecking = false;
  const timer = setInterval(() => {
    void check();
  }, 1000);
  async function check(): Promise<void> {
    if (isChecking) return;
    isChecking = true;
    try {
      const run = await dependencies.readRun();
      if (run && isActivePlanRun(run.status)) return;
      await dependencies.retire();
      clearInterval(timer);
    } catch {
      logEvent({
        level: "warn",
        event: "local.owner.retirement_failed",
        component: "LocalOwnerRetirement",
        message: "Local owner retirement could not be confirmed",
        metadata: { code: "internal" },
      });
    } finally {
      isChecking = false;
    }
  }
  return () => clearInterval(timer);
}
