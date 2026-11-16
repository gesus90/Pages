import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";
import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import {
  planTargetIssues,
  withInheritedPlanTarget,
} from "@/definition/AgentPlanTarget";
import { allPlanSteps } from "@/definition/AgentPlanGroup";
import { RUNNER_TOOL_PROVIDERS } from "@/definition/RunnerExecution";

import type { AgentPlanRemoteExecution } from "./AgentPlanRemoteExecution";
import type {
  AgentPlan,
  AgentPlanInput,
  AgentPlanStep,
} from "@/definition/AgentPlan";

/** Rechecks catalog identity and workspace rights before saving or starting the model copy. */
export async function validateRemoteModel(
  service: Pick<AgentPlanRemoteExecution, "sources">,
  userId: string,
  plan: Pick<AgentPlan, "projectId">,
  step: AgentPlanStep,
): Promise<void> {
  const route = requireRemoteModelRoute(step);
  const { models, statuses } = await service.sources(userId, plan.projectId, [
    route.workspaceId,
  ]);
  const issues = planTargetIssues(
    {
      name: "",
      workspaceId: route.workspaceId,
      usage: "private",
      projectId: plan.projectId,
      nodes: [step],
      edges: [],
      globals: {},
    },
    statuses,
  );
  if (issues.length)
    throw new AgentPlanValidationError(
      issues.map((issue) => ({
        nodeId: issue.nodeId,
        port: issue.port ?? null,
        reason: issue.problem,
      })),
    );
  if (
    !models.some(
      (model) =>
        model.id === step.configuration?.modelProfileId &&
        model.model === step.configuration.model &&
        (step.configuration.reasoningEffort === null ||
          model.reasoningEfforts.includes(
            step.configuration.reasoningEffort,
          )) &&
        planContentDigest(model.runnerRoute) === planContentDigest(route),
    )
  )
    throw new AgentError("plan_remote_unavailable");
}

/** Reauthorizes remote model routes before handing local configurations to the local resolver. */
export async function localPlanModelSteps(
  service: AgentPlanRemoteExecution | undefined,
  userId: string,
  plan: AgentPlanInput,
): Promise<readonly AgentPlanStep[]> {
  const local = [];
  // A node checks its model route against the target it runs on, which it may inherit.
  for (const step of allPlanSteps(withInheritedPlanTarget(plan))) {
    if (!step.configuration?.runnerRoute) {
      local.push(step);
      continue;
    }
    if (!service) throw new AgentError("plan_remote_unavailable");
    await service.validateModel(
      userId,
      { projectId: plan.projectId ?? "" },
      step,
    );
  }
  return local;
}

/** Requires a frozen route whose provider and target agree. */
export function requireRemoteModelRoute(
  step: AgentPlanStep,
): NonNullable<NonNullable<AgentPlanStep["configuration"]>["runnerRoute"]> {
  const route = step.configuration?.runnerRoute;
  if (
    !route ||
    step.configuration?.connectionId !== undefined ||
    step.configuration?.provider !==
      (route.tool ? RUNNER_TOOL_PROVIDERS[route.tool] : "openrouter") ||
    (!route.tool && step.configuration?.reasoningEffort !== null) ||
    step.executionTarget?.kind !== "remote" ||
    step.executionTarget.workspaceId !== route.workspaceId
  )
    throw new AgentError("plan_context_changed");
  return route;
}
