import { randomUUID } from "node:crypto";

import { readPlanInput } from "@/backend/agents/AgentPlanInput";
import { AgentError } from "@/backend/error/AgentErrors";
import { requireCredentialFreeText } from "@/backend/security/AgentTextSafety";
import { planExecutionIssues } from "@/definition/AgentPlanGraph";
import { withPortlessPlanGroups } from "@/definition/AgentPlanGroupUpgrade";

import {
  planOwnership,
  requireOwnerForProjectChange,
} from "./AgentPlanOwnership";
import { requireNoNewGitCloseout } from "./AgentPlanGitCloseoutLegacy";
import { validatePlanReferences } from "./AgentPlanReferences";

import type { AgentPlan, AgentPlanInput } from "@/definition/AgentPlan";
import type { PlanDependencies } from "./AgentPlanDependencies";
import type { AgentPlanConfigurationPins } from "./AgentPlanConfigurationPins";

interface RevisionContext {
  readonly userId: string;
  readonly id: string | null;
  readonly input: unknown;
  readonly pins: Pick<AgentPlanConfigurationPins, "pin">;
  readonly resolveWorkspace: (
    userId: string,
    plan: AgentPlanInput,
  ) => Promise<
    { readonly projectId: string } & Pick<AgentPlanInput, "executionTarget">
  >;
}

/** Validates a normal graph save under the editor's current access, preserving ownership and revision rules. */
export async function reviseAgentPlan(
  dependencies: PlanDependencies,
  context: RevisionContext,
): Promise<AgentPlan> {
  const { userId, id, input } = context;
  let proposed = withPortlessPlanGroups(readPlanInput(input));
  requireCredentialFreeText(JSON.stringify(proposed));
  const previous =
    id === null ? null : await dependencies.access.require(userId, id);
  if (previous && !previous.canEdit) throw new AgentError("plan_access_denied");
  if (previous && proposed.revision !== previous.revision)
    throw new AgentError("plan_conflict");
  requireNoNewGitCloseout(proposed, previous);
  // The workspace is resolved for the person who saves: the owner's access never stands in.
  const workspace = await context.resolveWorkspace(userId, proposed);
  if (workspace.executionTarget)
    proposed = { ...proposed, executionTarget: workspace.executionTarget };
  if (previous)
    requireOwnerForProjectChange(userId, previous, workspace.projectId);
  if (
    proposed.projectId !== undefined &&
    proposed.projectId !== workspace.projectId
  )
    throw new AgentError("plan_context_changed");
  proposed = await context.pins.pin(
    userId,
    { ...proposed, projectId: workspace.projectId },
    previous,
  );
  await validatePlanReferences(
    dependencies,
    userId,
    proposed,
    workspace.projectId,
  );
  await dependencies.remoteTargets?.validate(userId, proposed);
  const plan: AgentPlan = {
    ...proposed,
    ...(await planOwnership(dependencies.access, userId, previous)),
    id: id ?? randomUUID(),
    projectId: workspace.projectId,
    revision: proposed.revision ?? 1,
  };
  await dependencies.access.validateSharing(plan);
  if (plan.nodes.some((node) => node.type === "group")) {
    const catalog = await dependencies.profiles.catalog(userId, plan.projectId);
    if (planExecutionIssues(plan, catalog).length === 0)
      await dependencies.preparation.prepare(userId, plan);
  }
  return plan;
}
