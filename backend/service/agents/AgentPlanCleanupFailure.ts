import type { AgentPlanCleanupFailure } from "@/definition/AgentPlanCleanupResource";

/** Converts an operating-system scan failure to a fixed, non-sensitive reason. */
export function cleanupScanFailure(
  stepId: string,
  kind: AgentPlanCleanupFailure["kind"],
  error: unknown,
): AgentPlanCleanupFailure {
  const denied =
    error instanceof Error &&
    "code" in error &&
    (error.code === "EACCES" || error.code === "EPERM");
  return {
    stepId,
    kind,
    reason: denied ? "scan_access_denied" : "scan_unavailable",
  };
}
