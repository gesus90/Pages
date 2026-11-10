import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";

import type { AgentPlanInput } from "@/definition/AgentPlan";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";

/**
 * Refuses a save that would add a Git closeout node, which is no longer supported (PAGE-285).
 *
 * @remarks
 * A node the saved plan already contains under the same identifier stays as
 * it is, so an earlier plan can still be saved, moved and edited until
 * someone removes the node. A new plan, a copy and a template insertion get
 * new identifiers and are therefore refused, with the node named in the issue.
 *
 * @param proposed - The plan that is about to be saved.
 * @param previous - The saved plan, or `null` for a new plan.
 * @throws {AgentPlanValidationError} With the reason `gitCloseoutUnsupported`
 * for every Git closeout the saved plan did not contain.
 */
export function requireNoNewGitCloseout(
  proposed: AgentPlanInput,
  previous: AgentPlanInput | null,
): void {
  const saved = new Set(
    (previous?.nodes ?? [])
      .filter((node) => node.type === "git_closeout")
      .map((node) => node.id),
  );
  const issues: AgentPlanIssue[] = proposed.nodes
    .filter((node) => node.type === "git_closeout" && !saved.has(node.id))
    .map((node) => ({
      nodeId: node.id,
      port: null,
      reason: "gitCloseoutUnsupported",
    }));
  if (issues.length > 0) throw new AgentPlanValidationError(issues);
}
