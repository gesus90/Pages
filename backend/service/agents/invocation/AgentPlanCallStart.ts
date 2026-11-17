import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanSnapshot } from "../AgentPlanSnapshot";

/**
 * Whether a run is the fresh start of a call.
 * @remarks
 * A run that resumes or restarts a called run keeps the entry and inputs of
 * the call but is started by a person, who may replace running work; only a
 * run without an origin that carries a call is the call's own start, and
 * that one never displaces another run.
 */
export function isCallStart(
  run: Pick<AgentPlanRun, "origin">,
  snapshot: Pick<AgentPlanSnapshot, "invocation">,
): boolean {
  return snapshot.invocation !== undefined && run.origin === undefined;
}
