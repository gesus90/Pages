import { copyPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";
import { planExecutionIssues } from "@/definition/AgentPlanGraph";
import { scriptAssessmentVerdict } from "@/definition/AgentPlanScriptReport";
import { sessionAttemptId } from "@/definition/AgentSessionJournal";
import { PLAN_BLOCKER_RETRIES } from "@/definition/AgentPlanRetry";
import { canRunPlan, planTeamsOf } from "@/definition/AgentPlanTeam";

import {
  failedPlanAttempts,
  planBlockerClassOf,
} from "./AgentPlanBlockerRules";
import { classifyAgentRunError } from "./diagnosis/AgentRunErrorClassifier";
import {
  extractRunFailures,
  summarizeRunFailure,
} from "./diagnosis/RunFailures";
import { sharingEntry } from "./PageAgentOperationDefinition";
import { sanitizeArtifactText } from "./AgentPlanOutput";

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
  AgentPlanTeamRightsEntry,
} from "@/definition/AgentPlanOperations";
import type { AgentProfileDirectory } from "@/definition/AgentProfile";
import type { PageAgentSharingEntry } from "@/definition/PageAgentOperations";
import type {
  AgentRunErrorFields,
  AgentRunStarter,
} from "@/definition/AgentRunDiagnosis";

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

/** Every team of the plan with its name and rights; an unknown target keeps its identifier. */
function planTeams(
  plan: AgentPlanView,
  directory: AgentProfileDirectory,
): readonly AgentPlanTeamRightsEntry[] {
  return planTeamsOf(plan).map((team) => {
    const entries =
      team.kind === "group" ? directory.groups : directory.departments;
    return {
      kind: team.kind,
      id: team.targetId,
      name:
        entries.find((entry) => entry.id === team.targetId)?.name ??
        team.targetId,
      read: team.canRead,
      edit: team.canEdit,
      run: team.canRun,
    };
  });
}

/** A run of the plan by its start and status. */
export function runSummary(
  plan: Pick<AgentPlanView, "id" | "name">,
  entry: AgentPlanRunEntry & { readonly userId?: string },
  startedBy: AgentRunStarter = unnamedStarter(entry.userId),
): AgentPlanRunSummary {
  return {
    runId: entry.id,
    planId: plan.id,
    planName: plan.name,
    startedAt: entry.startedAt,
    status: entry.status,
    startedBy,
  };
}

/** The starter of a run nobody could name: the identifier alone, or empty without one. */
function unnamedStarter(userId = ""): AgentRunStarter {
  return { id: userId, displayName: userId };
}

/** The fixed class, code and hint of an error; nothing for a step or run without one. */
export function errorFields(
  error: string | null,
): Partial<AgentRunErrorFields> {
  if (error === null) return {};
  const { errorClass, errorCode, errorHint } = classifyAgentRunError(error);
  return { errorClass, errorCode, errorHint };
}

/**
 * The state of a plan for the person, from their own runs, newest first.
 *
 * @param plan - The plan.
 * @param entries - The person's runs of the plan, newest first.
 */
export function planState(
  plan: AgentPlanView,
  entries: readonly TeamRunEntry[],
  starters: ReadonlyMap<string, AgentRunStarter>,
): Pick<AgentPlanStatusEntry, "state" | "latestRun" | "runCount"> {
  const active = entries.find((entry) => isActivePlanRun(entry.status));
  const latest = entries.at(0);
  return {
    state: active && isActivePlanRun(active.status) ? active.status : "idle",
    latestRun: latest
      ? runSummary(plan, latest, starterOf(starters, latest))
      : null,
    runCount: entries.length,
  };
}

/** A run of a plan with the account that started it. */
export type TeamRunEntry = AgentPlanRunEntry & { readonly userId: string };

/** The starter of a run; an account nobody could name keeps its identifier. */
export function starterOf(
  starters: ReadonlyMap<string, AgentRunStarter>,
  entry: TeamRunEntry,
): AgentRunStarter {
  return (
    starters.get(entry.userId) ?? {
      id: entry.userId,
      displayName: entry.userId,
    }
  );
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
    canRun: canRunPlan(plan),
    adminAccess: plan.rights?.isAdminAccess === true,
    team: planTeam(plan, directory),
    teams: planTeams(plan, directory),
    sharing: planSharing(plan, directory),
    revision: plan.revision,
    nodeCount: plan.nodes.length,
    oneShot: plan.oneShot === true,
    ...(plan.scheduledDeletionAt
      ? { scheduledDeletionAt: plan.scheduledDeletionAt }
      : {}),
  };
}

/** A visible plan without its graph. */
export function planSummary(
  plan: AgentPlanView,
  directory: AgentProfileDirectory,
  entries: readonly TeamRunEntry[],
  starters: ReadonlyMap<string, AgentRunStarter>,
): AgentPlanSummary {
  const { state, latestRun } = planState(plan, entries, starters);
  return { ...planBase(plan, directory), state, latestRun };
}

/** The label of a node that refers to an agent or a ticket of the sources. */
function referenceLabel(
  node: AgentPlanNode,
  sources: AgentPlanSources,
): string | null {
  if (node.type === "agent")
    return (
      node.configuration?.name ??
      sources.agents.find((agent) => agent.id === node.agentId)?.name ??
      ""
    );
  if (node.type !== "task") return null;
  const task = sources.tasks.find((entry) => entry.id === node.taskId);
  return task ? `${task.key} · ${task.title}` : "";
}

function nodeLabel(node: AgentPlanNode, sources: AgentPlanSources): string {
  if (
    node.type === "group" ||
    node.type === "script" ||
    node.type === "git_closeout" ||
    node.type === "loop" ||
    node.type === "stack" ||
    node.type === "asset"
  )
    return node.name;
  if (node.type === "parameter" || node.type === "variable") return node.name;
  if (node.type === "decision") return node.name ?? "Decision";
  const reference = referenceLabel(node, sources);
  if (reference !== null) return reference;
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
  readonly entries: readonly TeamRunEntry[];
  readonly starters: ReadonlyMap<string, AgentRunStarter>;
  /** Live availability from the shared control service, when composed by Pages. */
  readonly isRunnable?: boolean;
}

/**
 * A visible plan with its graph, labels and status.
 *
 * @remarks
 * Structural findings and live control availability stay separate from
 * execution. Reading this projection never starts work.
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
      ...(issue.asset ? { asset: issue.asset } : {}),
    }),
  );
  return {
    ...planBase(plan, context.directory),
    executionTarget: plan.executionTarget ?? null,
    // The status comes before the graph, so a chat that shortens a long plan keeps it.
    status: {
      ...planState(plan, context.entries, context.starters),
      isRunnable: context.isRunnable ?? issues.length === 0,
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
    step.skipped === true ||
    Boolean(step.session ?? step.script)
  );
}

/** Includes a recorded dependency cause without inventing one for older runs. */
function blockedBy(
  step: AgentPlanStepResult,
): Pick<AgentPlanRunStepEntry, "blockedByStepId"> {
  return step.blockedByStepId ? { blockedByStepId: step.blockedByStepId } : {};
}

function stepStatus(step: AgentPlanStepResult): AgentPlanRunStepEntry {
  const { session } = step;
  return {
    stepId: step.id,
    ...stepExecutionIdentity(step),
    name: step.name,
    status: step.status,
    ...(step.skipped === true ? { skipped: true } : {}),
    isBlocked: step.isBlocked,
    ...blockedBy(step),
    error: step.error,
    ...errorFields(step.error),
    verdict:
      session?.acceptance?.verdict ?? scriptAssessmentVerdict(step.report),
    ...stepTimes(step),
    hasReport: hasReport(step),
    ...(step.agentTodos ? { agentTodos: step.agentTodos } : {}),
    ...stepRetry(step),
  };
}

/** Exposes the stored retry budget without native session identifiers. */
function stepRetry(
  step: AgentPlanStepResult,
): Pick<AgentPlanRunStepEntry, "retry" | "failureStop"> {
  const stop = step.failureStop ? { failureStop: step.failureStop } : {};
  const retry = step.session?.retry;
  if (!retry) return stop;
  const last = retry.attempts.at(-1);
  const failureClass =
    retry.failureClass ?? last?.failureClass ?? planBlockerClassOf(last?.code);
  return {
    ...stop,
    retry: {
      failureClass,
      state: retry.state,
      reason: retry.reason,
      attemptsFailed: failedPlanAttempts(retry.attempts, failureClass),
      maximumAttempts: PLAN_BLOCKER_RETRIES[failureClass] + 1,
      nextAttemptAt: retry.nextAttemptAt,
      resetAt: retry.resetAt,
      lastError: last?.code ?? null,
      attempts: retry.attempts.map((attempt) => ({
        attemptId: attempt.attemptId,
        endedAt: attempt.endedAt,
        code: attempt.code,
        failureClass: attempt.failureClass ?? planBlockerClassOf(attempt.code),
        ...(attempt.issues ? { issues: attempt.issues } : {}),
      })),
    },
  };
}

function stepTimes(
  step: AgentPlanStepResult,
): Pick<AgentPlanRunStepEntry, "startedAt" | "endedAt"> {
  return {
    startedAt:
      step.script?.startedAt ??
      step.session?.startedAt ??
      step.remote?.startedAt ??
      null,
    endedAt:
      step.script?.endedAt ??
      step.session?.endedAt ??
      step.remote?.endedAt ??
      null,
  };
}

/** The time the last node ended; an active run has not ended. */
function runEnd(run: AgentPlanRun): string | null {
  if (isActivePlanRun(run.status)) return null;
  if (run.endedAt) return run.endedAt;
  const ends = run.steps.flatMap((step) => {
    const { endedAt } = stepTimes(step);
    return endedAt ? [endedAt] : [];
  });
  return ends.sort().at(-1) ?? null;
}

/** A run with the state of its nodes, without their result texts. */
export function runDetail(
  run: AgentPlanRun,
  startedBy: AgentRunStarter = unnamedStarter(run.userId),
): AgentPlanRunDetail {
  const failure = summarizeRunFailure(run, extractRunFailures(run));
  return {
    runId: run.id,
    planId: run.planId,
    planName: run.planName,
    startedBy,
    ...(failure
      ? {
          failedStepId: failure.failedStepId,
          errorClass: failure.errorClass,
          errorCode: failure.errorCode,
          errorHint: failure.errorHint,
        }
      : {}),
    planRevision: run.planRevision,
    appliedPlanRevision: run.continuation?.planRevision ?? run.planRevision,
    continuationVersion: run.continuation?.version ?? 0,
    startedAt: run.startedAt,
    endedAt: runEnd(run),
    status: run.status,
    stopRequested: run.stopRequested,
    ...(run.recovery?.automaticResume
      ? { automaticResume: run.recovery.automaticResume }
      : {}),
    steps: run.steps.map(stepStatus),
    loops: (run.loops ?? []).map((loop) => ({
      loopId: loop.id,
      status: loop.status,
      completion: loop.completion,
      cleanup: loop.cleanup,
      iterations: loop.iterations.map((iteration) => ({
        iteration: iteration.number,
        status: iteration.status,
        steps: iteration.nodes.map(stepStatus),
      })),
    })),
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
  const output =
    step.output === null ? null : sanitizeArtifactText(step.output);
  const text = (
    items: NonNullable<typeof contract>["todos"],
    id: string,
  ): string =>
    sanitizeArtifactText(items.find((item) => item.id === id)?.text ?? "");
  return {
    runId: run.id,
    planId: run.planId,
    stepId: step.id,
    name: step.name,
    status: step.status,
    startedAt: status.startedAt,
    endedAt: status.endedAt,
    output,
    isOutputFiltered: output !== step.output,
    error: step.error,
    ...errorFields(step.error),
    ...blockedBy(step),
    verdict: status.verdict,
    ...reportDetails(step),
    todos: (acceptance?.todos ?? []).map((todo) => ({
      id: todo.id,
      text: text(contract?.todos ?? [], todo.id),
      status: todo.status,
    })),
    criteria: (acceptance?.criteria ?? []).map((criterion) => ({
      id: criterion.id,
      text: text(contract?.criteria ?? [], criterion.id),
      met: criterion.met,
      evidence: sanitizeArtifactText(criterion.evidence),
    })),
    decisions: (acceptance?.decisions ?? []).map(sanitizeArtifactText),
    agentTodos: step.agentTodos ?? null,
  };
}

function reportDetails(
  step: AgentPlanStepResult,
): Pick<AgentPlanReport, "summary" | "issues"> {
  const summary =
    step.session?.acceptance?.summary ?? step.report?.summary ?? null;
  return {
    summary: summary === null ? null : sanitizeArtifactText(summary),
    issues: (step.session?.acceptance?.issues ?? scriptReportIssues(step)).map(
      sanitizeArtifactText,
    ),
  };
}

function scriptReportIssues(step: AgentPlanStepResult): readonly string[] {
  if (!step.report) return [];
  return [
    ...(step.report.failedCount
      ? [`checks_failed:${step.report.failedCount}`]
      : []),
    ...(step.report.partialCount
      ? [`checks_partial:${step.report.partialCount}`]
      : []),
  ];
}

function stepExecutionIdentity(
  step: AgentPlanStepResult,
): Pick<AgentPlanRunStepEntry, "execution" | "attemptId"> {
  const attemptId =
    step.script?.attemptId ??
    (step.session ? sessionAttemptId(step.session, step.id) : undefined) ??
    step.execution?.attemptId;
  return {
    ...(step.execution ? { execution: step.execution } : {}),
    ...(attemptId ? { attemptId } : {}),
  };
}
