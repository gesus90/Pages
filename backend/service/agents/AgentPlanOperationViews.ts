import { copyPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";
import { planExecutionIssues } from "@/definition/AgentPlanGraph";

import { sharingEntry } from "./PageAgentOperationDefinition";
import { hasRemotePlanTarget } from "./AgentPlanExecutionTargets";

import type { AgentPlanRunEntry } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentDefinitionChoice } from "@/definition/AgentAvailability";
import type {
  AgentPlanNode,
  AgentPlanRun,
  AgentPlanSources,
  AgentPlanStepResult,
  AgentPlanView,
} from "@/definition/AgentPlan";
import type {
  AgentPlanAgentEntry,
  AgentPlanDetail,
  AgentPlanNodeEntry,
  AgentPlanReport,
  AgentPlanRunDetail,
  AgentPlanRunStepEntry,
  AgentPlanRunSummary,
  AgentPlanStatusEntry,
  AgentPlanSummary,
  AgentPlanTeamEntry,
} from "@/definition/AgentPlanOperations";
import type { AgentProfileDirectory } from "@/definition/AgentProfile";
import type { PageAgentSharingEntry } from "@/definition/PageAgentOperations";

/**
 * The share of a plan as a client reads it.
 *
 * @remarks
 * A private plan is private whatever its share says. Older shared plans
 * without a share were open to everyone with access to the workspace's
 * project, which reads as `global`.
 */
function planSharing(
  plan: AgentPlanView,
  directory: AgentProfileDirectory,
): PageAgentSharingEntry {
  if (plan.usage === "private" || plan.sharing === undefined)
    return {
      scope: plan.usage === "private" ? "private" : "global",
      operator: null,
      groups: [],
      departments: [],
    };
  return sharingEntry(plan.sharing, directory);
}

/** The department a plan was created for, as long as it still exists. */
function planTeam(
  plan: AgentPlanView,
  directory: AgentProfileDirectory,
): AgentPlanTeamEntry | null {
  const department = directory.departments.find(
    (entry) => entry.id === plan.departmentId,
  );
  return department ? { id: department.id, name: department.name } : null;
}

/** A run of the plan by its start and status. */
export function runSummary(
  plan: Pick<AgentPlanView, "id" | "name">,
  entry: AgentPlanRunEntry,
): AgentPlanRunSummary {
  return {
    runId: entry.id,
    planId: plan.id,
    planName: plan.name,
    startedAt: entry.startedAt,
    status: entry.status,
  };
}

/**
 * The state of a plan for the person, from their own runs, newest first.
 *
 * @param plan - The plan.
 * @param entries - The person's runs of the plan, newest first.
 */
export function planState(
  plan: AgentPlanView,
  entries: readonly AgentPlanRunEntry[],
): Pick<AgentPlanStatusEntry, "state" | "latestRun" | "runCount"> {
  const active = entries.find((entry) => isActivePlanRun(entry.status));
  const latest = entries.at(0);
  return {
    state: active && isActivePlanRun(active.status) ? active.status : "idle",
    latestRun: latest ? runSummary(plan, latest) : null,
    runCount: entries.length,
  };
}

/** What a summary and a detailed read of a plan share. */
function planBase(
  plan: AgentPlanView,
  directory: AgentProfileDirectory,
): Omit<AgentPlanSummary, "state" | "latestRun"> {
  return {
    id: plan.id,
    name: plan.name,
    projectId: plan.projectId,
    projectName: plan.projectName,
    workspaceId: plan.workspaceId,
    ownerId: plan.ownerId,
    canEdit: plan.canEdit,
    team: planTeam(plan, directory),
    sharing: planSharing(plan, directory),
    revision: plan.revision,
    nodeCount: plan.nodes.length,
  };
}

/** A visible plan without its graph. */
export function planSummary(
  plan: AgentPlanView,
  directory: AgentProfileDirectory,
  entries: readonly AgentPlanRunEntry[],
): AgentPlanSummary {
  const { state, latestRun } = planState(plan, entries);
  return { ...planBase(plan, directory), state, latestRun };
}

function nodeLabel(node: AgentPlanNode, sources: AgentPlanSources): string {
  if (node.type === "group" || node.type === "script" || node.type === "loop")
    return node.name;
  if (node.type === "agent")
    return (
      node.configuration?.name ??
      sources.agents.find((agent) => agent.id === node.agentId)?.name ??
      ""
    );
  if (node.type === "task") {
    const task = sources.tasks.find((entry) => entry.id === node.taskId);
    return task ? `${task.key} · ${task.title}` : "";
  }
  if (node.type === "parameter" || node.type === "variable") return node.name;
  return node.type === "start" ? "Start" : "End";
}

/** A node as the plan stores it, with the label the plan page shows. */
function nodeEntry(
  node: AgentPlanNode,
  sources: AgentPlanSources,
): AgentPlanNodeEntry {
  return { ...node, label: nodeLabel(node, sources) };
}

/** What a detailed read of a plan needs besides the plan. */
export interface AgentPlanDetailContext {
  readonly directory: AgentProfileDirectory;
  readonly sources: AgentPlanSources;
  readonly entries: readonly AgentPlanRunEntry[];
}

/**
 * A visible plan with its graph, labels and status.
 *
 * @remarks
 * The status checks the graph like Play on the plan page does, with the
 * agents the person may use now; nothing is started or prepared.
 */
export function planDetail(
  plan: AgentPlanView,
  context: AgentPlanDetailContext,
): AgentPlanDetail {
  const issues = planExecutionIssues(plan, context.sources.agents).map(
    (issue) => ({
      nodeId: issue.nodeId,
      port: issue.port,
      problem: issue.reason,
    }),
  );
  return {
    ...planBase(plan, context.directory),
    // The status comes before the graph, so a chat that shortens a long plan keeps it.
    status: {
      ...planState(plan, context.entries),
      isRunnable: issues.length === 0 && !hasRemotePlanTarget(plan),
      issues,
    },
    nodes: plan.nodes.map((node) => nodeEntry(node, context.sources)),
    edges: plan.edges.map((edge) => ({ ...edge })),
    globals: plan.globals,
  };
}

/** An agent a node may run, with the inputs it declares and nothing of its connection. */
export function agentEntry(agent: AgentDefinitionChoice): AgentPlanAgentEntry {
  const { configuration } = agent;
  return {
    id: agent.id,
    name: agent.name,
    model: agent.model,
    isUsable: agent.availability.isUsable,
    configuration: copyPlanConfiguration(agent),
    directoryParameter: configuration.directoryParameter,
    parameters: configuration.parameters.map((parameter) => ({
      name: parameter.name,
      type: parameter.type,
      description: parameter.description,
      isRequired: parameter.isRequired,
    })),
  };
}

/** Whether a node of a run has a result, an error or a session to report. */
export function hasReport(step: AgentPlanStepResult): boolean {
  return (
    step.output !== null ||
    step.error !== null ||
    Boolean(step.session ?? step.script)
  );
}

function stepStatus(step: AgentPlanStepResult): AgentPlanRunStepEntry {
  const { session } = step;
  return {
    stepId: step.id,
    ...stepExecutionIdentity(step),
    name: step.name,
    status: step.status,
    isBlocked: step.isBlocked,
    error: step.error,
    verdict: session?.acceptance?.verdict ?? null,
    startedAt: step.script?.startedAt ?? session?.startedAt ?? null,
    endedAt: step.script?.endedAt ?? session?.endedAt ?? null,
    hasReport: hasReport(step),
  };
}

/** The time the last node ended; an active run has not ended. */
function runEnd(run: AgentPlanRun): string | null {
  if (isActivePlanRun(run.status)) return null;
  if (run.endedAt) return run.endedAt;
  const ends = run.steps.flatMap((step) => {
    const endedAt = step.script?.endedAt ?? step.session?.endedAt;
    return endedAt ? [endedAt] : [];
  });
  return ends.sort().at(-1) ?? null;
}

/** A run with the state of its nodes, without their result texts. */
export function runDetail(run: AgentPlanRun): AgentPlanRunDetail {
  return {
    runId: run.id,
    planId: run.planId,
    planName: run.planName,
    planRevision: run.planRevision,
    startedAt: run.startedAt,
    endedAt: runEnd(run),
    status: run.status,
    stopRequested: run.stopRequested,
    steps: run.steps.map(stepStatus),
  };
}

/** The report of one node, bound to its run by the run and node identifiers. */
export function stepReport(
  run: AgentPlanRun,
  step: AgentPlanStepResult,
): AgentPlanReport {
  const status = stepStatus(step);
  const contract = step.session?.contract ?? null;
  const acceptance = step.session?.acceptance ?? null;
  const text = (
    items: NonNullable<typeof contract>["todos"],
    id: string,
  ): string => items.find((item) => item.id === id)?.text ?? "";
  return {
    runId: run.id,
    planId: run.planId,
    stepId: step.id,
    name: step.name,
    status: step.status,
    startedAt: status.startedAt,
    endedAt: status.endedAt,
    output: step.output,
    error: step.error,
    verdict: status.verdict,
    summary: acceptance?.summary ?? null,
    todos: (acceptance?.todos ?? []).map((todo) => ({
      id: todo.id,
      text: text(contract?.todos ?? [], todo.id),
      status: todo.status,
    })),
    criteria: (acceptance?.criteria ?? []).map((criterion) => ({
      id: criterion.id,
      text: text(contract?.criteria ?? [], criterion.id),
      met: criterion.met,
      evidence: criterion.evidence,
    })),
    decisions: acceptance?.decisions ?? [],
    issues: acceptance?.issues ?? [],
  };
}

function stepExecutionIdentity(
  step: AgentPlanStepResult,
): Pick<AgentPlanRunStepEntry, "execution" | "attemptId"> {
  if (!step.execution) return {};
  return {
    execution: step.execution,
    attemptId:
      step.script?.attemptId ??
      step.session?.attemptId ??
      step.execution.attemptId,
  };
}
