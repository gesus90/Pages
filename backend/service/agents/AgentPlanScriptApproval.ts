import { createHash } from "node:crypto";

import type { AgentPlan } from "@/definition/AgentPlan";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";
import type { AgentPlanScriptApprovalState } from "@/definition/AgentPlanTeam";
import type { AgentPlanScriptApproval } from "@/backend/database/repositories/agent/AgentPlanScriptApprovalRepository";

/**
 * The script steps that run as processes on the Pages host: active and not remote.
 *
 * @param plan - The plan.
 */
export function localPlanScripts(
  plan: Pick<AgentPlan, "nodes">,
): readonly AgentPlanScript[] {
  return plan.nodes.filter(
    (node): node is AgentPlanScript =>
      node.type === "script" &&
      !node.disabled &&
      node.executionTarget?.kind !== "remote",
  );
}

/**
 * The hash an approval of a script step is bound to (PAGE-329, part C).
 *
 * @remarks
 * It covers the script content, the interpreter profile and the workspace the
 * script runs in. Changing any of them yields another hash, which lifts the
 * approval; changing anything else of the plan keeps it.
 *
 * @param plan - The plan whose workspace the script runs in.
 * @param script - The script step.
 * @returns The lowercase hexadecimal SHA-256.
 */
export function scriptApprovalHash(
  plan: Pick<AgentPlan, "workspaceId">,
  script: Pick<AgentPlanScript, "content" | "interpreterProfileId">,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        script.content,
        script.interpreterProfileId,
        plan.workspaceId,
      ]),
    )
    .digest("hex");
}

/**
 * Which local script steps of the plan lack an approval of their current content.
 *
 * @param plan - The plan as it is started or shown.
 * @param approvals - The stored approvals by step.
 */
export function scriptApprovalState(
  plan: Pick<AgentPlan, "nodes" | "workspaceId">,
  approvals: ReadonlyMap<string, Pick<AgentPlanScriptApproval, "contentHash">>,
): AgentPlanScriptApprovalState {
  const scripts = localPlanScripts(plan);
  return {
    hasScripts: scripts.length > 0,
    unapprovedStepIds: scripts
      .filter(
        (script) =>
          approvals.get(script.id)?.contentHash !==
          scriptApprovalHash(plan, script),
      )
      .map((script) => script.id),
  };
}
