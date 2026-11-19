import { randomUUID } from "node:crypto";

import { readPlanInput } from "@/backend/agents/AgentPlanInput";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";
import { requireCredentialFreeText } from "@/backend/security/AgentTextSafety";
import { planExecutionIssues } from "@/definition/AgentPlanGraph";
import { withPortlessPlanGroups } from "@/definition/AgentPlanGroupUpgrade";
import {
  isPlanJumpOut,
  planCalledPlanIds,
  wouldCloseCallCycle,
} from "@/definition/AgentPlanJump";

import { requireManagementPlanAccess } from "../management/ManagementPlanAccess";
import {
  planOwnership,
  requireOwnerForProjectChange,
} from "./AgentPlanOwnership";
import { validatePlanReferences } from "./AgentPlanReferences";

import type { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import type {
  AgentPlan,
  AgentPlanInput,
  AgentPlanView,
} from "@/definition/AgentPlan";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";
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

/**
 * Requires an editable stored plan and the revision the editor saw.
 * @param previous - The stored plan, or `null` for a new plan.
 * @param proposed - The graph the editor saves.
 * @throws {AgentError} `plan_access_denied` without edit rights, `plan_conflict` for another revision.
 */
function requireRevisionMatches(
  previous: AgentPlanView | null,
  proposed: AgentPlanInput,
): void {
  if (!previous) return;
  if (!previous.canEdit) throw new AgentError("plan_access_denied");
  if (proposed.revision !== previous.revision)
    throw new AgentError("plan_conflict");
}

/**
 * Prepares the execution of a saved plan that has groups and can run as it is.
 * @param dependencies - The plan dependencies of the service.
 * @param userId - The person who saves the plan.
 * @param plan - The plan as it is stored.
 */
async function prepareExecutableGroups(
  dependencies: PlanDependencies,
  userId: string,
  plan: AgentPlan,
): Promise<void> {
  if (!plan.nodes.some((node) => node.type === "group")) return;
  const catalog = await dependencies.profiles.catalog(userId, plan.projectId);
  if (planExecutionIssues(plan, catalog).length === 0)
    await dependencies.preparation.prepare(userId, plan);
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
  requireRevisionMatches(previous, proposed);
  const team = await dependencies.access.team(userId, null);
  requireManagementPlanAccess(team.isManagement === true, proposed, previous);
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
  await requireNoPlanCallCycle(dependencies.plans, plan);
  if (!team.isManagement)
    await prepareExecutableGroups(dependencies, userId, plan);
  return plan;
}

function requireNoNewGitCloseout(
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

async function requireNoPlanCallCycle(
  plans: Pick<AgentPlanRepository, "list">,
  plan: AgentPlan,
): Promise<void> {
  if (planCalledPlanIds(plan).length === 0) return;
  const calls = (await plans.list())
    .filter((other) => other.id !== plan.id)
    .flatMap((other) =>
      planCalledPlanIds(other).map((to) => ({ from: other.id, to })),
    );
  const offending = plan.nodes.filter(
    (node) =>
      isPlanJumpOut(node) &&
      node.target !== null &&
      wouldCloseCallCycle(calls, plan.id, node.target.planId),
  );
  if (offending.length > 0)
    throw new AgentPlanValidationError(
      offending.map((node) => ({
        nodeId: node.id,
        port: null,
        reason: "jumpCycle" as const,
      })),
    );
}
