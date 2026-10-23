import { allPlanSteps } from "@/definition/AgentPlanGroup";
import { AgentError } from "@/backend/error/AgentErrors";

import { validatePlanGraph } from "./AgentPlanGraph";

import type { AgentPlanInput, AgentPlanNode } from "@/definition/AgentPlan";
import type {
  AgentParameter,
  AgentParameterValue,
} from "@/definition/AgentParameters";
import type { AgentProfileService } from "./AgentProfileService";
import type { AgentParameterService } from "./AgentParameterService";
import type { AgentPlanTasks } from "./AgentPlanTasks";
import type { AgentWorkspaceService } from "./AgentWorkspaceService";

interface ReferenceDependencies {
  readonly profiles: Pick<AgentProfileService, "catalog" | "isVisible">;
  readonly parameters: Pick<
    AgentParameterService,
    "requireTicket" | "requireWiki"
  >;
  readonly tasks: Pick<AgentPlanTasks, "snapshot">;
  readonly workspaces: Pick<AgentWorkspaceService, "resolve">;
}

function nodeParameters(node: AgentPlanNode): readonly AgentParameter[] {
  if (node.type === "agent")
    return node.configuration?.template.parameters ?? [];
  return node.type === "group" ? node.parameters : [];
}

function referenceValues(node: AgentPlanNode): readonly AgentParameterValue[] {
  const values: AgentParameterValue[] =
    node.type === "parameter" ? [node.value] : [];
  for (const parameter of nodeParameters(node))
    if (parameter.defaultValue) values.push(parameter.defaultValue);
  if ("bindings" in node)
    for (const binding of Object.values(node.bindings))
      if (binding.kind === "literal" && binding.value)
        values.push(binding.value);
  return values;
}

/** Reauthorizes every persisted external value on save, including legacy group defaults and loop scripts. */
export async function validatePlanReferences(
  dependencies: ReferenceDependencies,
  userId: string,
  plan: AgentPlanInput,
  projectId: string,
): Promise<void> {
  validatePlanGraph(
    plan,
    await dependencies.profiles.catalog(userId, projectId),
  );
  const nodes = [
    ...plan.nodes.filter((node) => node.type !== "agent"),
    ...allPlanSteps(plan),
    ...plan.nodes.flatMap((node) =>
      node.type === "loop"
        ? node.steps.filter((member) => member.type === "script")
        : [],
    ),
  ];
  for (const node of nodes) {
    if (node.type === "task")
      await dependencies.tasks.snapshot(userId, projectId, node.taskId);
    if (
      node.type === "agent" &&
      node.personalAgentId &&
      !(await dependencies.profiles.isVisible(userId, node.personalAgentId))
    )
      throw new AgentError("parameter_reference_unavailable");
    for (const reference of referenceValues(node)) {
      if (reference.type === "ticket")
        await dependencies.parameters.requireTicket(userId, reference.ticketId);
      if (reference.type === "wiki")
        await dependencies.parameters.requireWiki(userId, reference.pageId);
      if (reference.type === "workspace")
        await dependencies.workspaces.resolve(
          userId,
          reference.workspaceId,
          projectId,
        );
    }
  }
}
