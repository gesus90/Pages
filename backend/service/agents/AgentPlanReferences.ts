import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";
import { withInheritedPlanTarget } from "@/definition/AgentPlanTarget";
import { allPlanSteps } from "@/definition/AgentPlanGroup";
import { AgentError } from "@/backend/error/AgentErrors";

import { validatePlanGraph } from "./AgentPlanGraph";
import { remoteParameterError } from "./AgentPlanRemoteParameters";

import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";
import type { AgentPlanInput, AgentPlanNode } from "@/definition/AgentPlan";
import type {
  AgentParameter,
  AgentParameterValue,
} from "@/definition/AgentParameters";
import type { AgentProfileService } from "./AgentProfileService";
import type { AgentParameterService } from "./AgentParameterService";
import type { AgentPlanTasks } from "./AgentPlanTasks";
import type { AgentWorkspaceService } from "./AgentWorkspaceService";
import type { AgentPlanRemoteTargets } from "./AgentPlanRemoteTargets";

interface ReferenceDependencies {
  readonly remoteTargets?: AgentPlanRemoteTargets;
  readonly profiles: Pick<AgentProfileService, "catalog" | "isVisible">;
  readonly parameters: Pick<
    AgentParameterService,
    "requireTicket" | "requireWiki"
  >;
  readonly tasks: Pick<AgentPlanTasks, "snapshot">;
  readonly workspaces: Pick<AgentWorkspaceService, "resolve">;
}

interface PlanReference {
  readonly value: AgentParameterValue;
  readonly parameter: string | null;
}

function nodeParameters(node: AgentPlanNode): readonly AgentParameter[] {
  if (node.type === "agent")
    return node.configuration?.template.parameters ?? [];
  return node.type === "group" ? node.parameters : [];
}

function referenceValues(node: AgentPlanNode): readonly PlanReference[] {
  const values: PlanReference[] =
    node.type === "parameter" ? [{ value: node.value, parameter: null }] : [];
  for (const parameter of nodeParameters(node))
    if (parameter.defaultValue)
      values.push({ value: parameter.defaultValue, parameter: parameter.name });
  if ("bindings" in node)
    for (const [name, binding] of Object.entries(node.bindings))
      if (binding.kind === "literal" && binding.value)
        values.push({ value: binding.value, parameter: name });
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
  const validationIssues: AgentPlanIssue[] = [];
  for (const node of nodes) {
    try {
      await validateNodeAccess(dependencies, userId, { node, projectId });
      validationIssues.push(
        ...(await validateNodeReferences(dependencies, userId, {
          plan,
          node,
          projectId,
        })),
      );
    } catch (error: unknown) {
      if (error instanceof AgentPlanValidationError) throw error;
      const issues = remoteReferenceIssues(plan, node, error);
      if (issues.length) {
        validationIssues.push(...issues);
        continue;
      }
      throw error;
    }
  }
  if (validationIssues.length)
    throw new AgentPlanValidationError(validationIssues);
}

async function validateNodeAccess(
  dependencies: ReferenceDependencies,
  userId: string,
  context: {
    readonly node: AgentPlanNode;
    readonly projectId: string;
  },
): Promise<void> {
  const { node, projectId } = context;
  if (node.type === "task")
    await dependencies.tasks.snapshot(userId, projectId, node.taskId);
  if (
    node.type === "agent" &&
    node.personalAgentId &&
    !(await dependencies.profiles.isVisible(userId, node.personalAgentId))
  )
    throw new AgentError("parameter_reference_unavailable");
}

async function validateNodeReferences(
  dependencies: ReferenceDependencies,
  userId: string,
  context: {
    readonly plan: AgentPlanInput;
    readonly node: AgentPlanNode;
    readonly projectId: string;
  },
): Promise<readonly AgentPlanIssue[]> {
  const { plan, node, projectId } = context;
  const issues: AgentPlanIssue[] = [];
  for (const reference of referenceValues(node)) {
    try {
      await validateReference(dependencies, userId, reference.value, {
        projectId,
        canUseRemoteWorkspace: allowsRemoteWorkspace(plan, node),
      });
    } catch (error: unknown) {
      const mapped = remoteReferenceIssues(plan, node, error).filter(
        (issue) =>
          reference.parameter === null || issue.port === reference.parameter,
      );
      if (mapped.length === 0) throw error;
      issues.push(...mapped);
    }
  }
  return issues;
}

async function validateReference(
  dependencies: ReferenceDependencies,
  userId: string,
  reference: AgentParameterValue,
  context: {
    readonly projectId: string;
    readonly canUseRemoteWorkspace: boolean;
  },
): Promise<void> {
  if (reference.type === "ticket")
    await dependencies.parameters.requireTicket(userId, reference.ticketId);
  if (reference.type === "wiki")
    await dependencies.parameters.requireWiki(userId, reference.pageId);
  if (
    reference.type === "workspace" &&
    (!context.canUseRemoteWorkspace ||
      !(
        await dependencies.remoteTargets?.list(userId, context.projectId)
      )?.some((workspace) => workspace.workspaceId === reference.workspaceId))
  )
    await dependencies.workspaces.resolve(
      userId,
      reference.workspaceId,
      context.projectId,
    );
}

/** Maps an unavailable reference to each remote consumer and its declared parameter. */
export function remoteReferenceIssues(
  plan: AgentPlanInput,
  source: AgentPlanNode,
  error: unknown,
): readonly AgentPlanIssue[] {
  return allPlanSteps(withInheritedPlanTarget(plan)).flatMap((step) => {
    if (step.executionTarget?.kind !== "remote") return [];
    return (step.configuration?.template.parameters ?? []).flatMap(
      (parameter) => {
        const binding = step.bindings[parameter.name];
        const isSource =
          binding?.kind === "source" && binding.nodeId === source.id;
        if (!isSource && step.id !== source.id) return [];
        return remoteParameterError(
          step.id,
          parameter.name,
          source.type === "task" ? "ticket" : parameter.type,
          error,
        ).issues;
      },
    );
  });
}

function allowsRemoteWorkspace(
  plan: AgentPlanInput,
  node: AgentPlanNode,
): boolean {
  const steps = allPlanSteps(withInheritedPlanTarget(plan));
  const consumers = steps.filter(
    (step) =>
      step.id === node.id ||
      Object.values(step.bindings).some(
        (binding) => binding.kind === "source" && binding.nodeId === node.id,
      ),
  );
  return consumers.length > 0
    ? consumers.every((step) => step.executionTarget?.kind === "remote")
    : plan.executionTarget?.kind === "remote";
}
