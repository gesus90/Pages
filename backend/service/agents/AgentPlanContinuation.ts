import { AgentError } from "@/backend/error/AgentErrors";
import { isPlanFlowNode } from "@/definition/AgentPlanGraph";
import {
  inPlanSequence,
  planFlowSequence,
} from "@/definition/AgentPlanSequence";
import { isSamePlanTarget } from "@/definition/AgentPlanTarget";
import {
  agentRunOptionsFor,
  isAcpProvider,
} from "@/definition/AgentConfiguration";
import { isApiProvider } from "@/definition/AgentConnection";
import { withGroupResults } from "./AgentPlanGroupResults";
import { groupRuntimeFields } from "./AgentPlanGroupRuntime";
import { initialLoopRun } from "./loop/AgentPlanLoopRecord";
import { continueRemotePlanExecution } from "./AgentPlanExecutionSnapshot";
import { planStepDirectory } from "./AgentPlanSnapshot";
import { remoteWorkspaceKeys } from "./AgentPlanRemoteWorkspaceKey";
import type {
  AgentPlanRun,
  AgentPlanStepResult,
  AgentPlanNode,
} from "@/definition/AgentPlan";
import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";

/** Directories remain reserved through pause and closeout, including newly adopted ones. */
export function planWritingWorkspaces(
  snapshot: AgentPlanSnapshot,
): readonly string[] {
  return [
    ...new Set([
      ...snapshot.steps.flatMap((step) => {
        const directory = planStepDirectory(step);
        const isReader =
          isAcpProvider(step.provider) &&
          agentRunOptionsFor(step.provider, step.template.run).access ===
            "read_only";
        return !isApiProvider(step.provider) && directory && !isReader
          ? [`local-directory:${directory.path}`]
          : [];
      }),
      ...(snapshot.scripts ?? []).map(
        (script) => `local-directory:${script.workspace.path}`,
      ),
      ...(snapshot.remoteSteps ?? []).flatMap((step) =>
        step.command.program.kind === "model" ||
        (step.command.program.kind === "cli" &&
          step.command.program.access === "read_only")
          ? []
          : remoteWorkspaceKeys(step.target),
      ),
    ]),
  ];
}

function requireBoundary(
  run: AgentPlanRun,
  previous: AgentPlanSnapshot,
  next: AgentPlanSnapshot,
): void {
  const boundary = run.pauseBoundary;
  if (!boundary || run.stopRequested || run.status !== "paused")
    throw new AgentError("plan_run_unavailable");
  // A paused run keeps the context it started with, its plan target included.
  if (
    previous.plan.projectId !== next.plan.projectId ||
    previous.plan.workspaceId !== next.plan.workspaceId ||
    !isSamePlanTarget(previous.plan.executionTarget, next.plan.executionTarget)
  )
    throw new AgentError("plan_context_changed");
  if (
    boundary.frontierStepIds.some(
      (id) =>
        !next.plan.nodes.some((node) => node.id === id && isPlanFlowNode(node)),
    )
  )
    throw new AgentError("plan_continuation_deleted");
  for (const id of boundary.completedStepIds) {
    // Group summaries are derived; only real scheduler nodes define dependencies.
    const old = previous.plan.nodes.find((node) => node.id === id);
    if (!old) continue;
    const node = next.plan.nodes.find((entry) => entry.id === id);
    const dependencies = (snapshot: AgentPlanSnapshot): string =>
      JSON.stringify(
        snapshot.plan.edges
          .filter((edge) => edge.to === id)
          .map((edge) => edge.from)
          .sort(),
      );
    if (
      !node ||
      node.type !== old.type ||
      dependencies(previous) !== dependencies(next)
    )
      throw new AgentError("plan_completed_changed");
  }
}

function requireRetainedGroups(
  run: AgentPlanRun,
  previous: AgentPlanSnapshot,
  next: AgentPlanSnapshot,
): void {
  const completed = new Set(run.pauseBoundary?.completedStepIds);
  const startedGroups = new Set(
    previous.steps
      .filter((step) => completed.has(step.step.id) && step.groupId)
      .map((step) => step.groupId),
  );
  for (const step of next.steps) {
    const old = previous.steps.find((entry) => entry.step.id === step.step.id);
    requireGroupMembership(old, step, completed, startedGroups);
    if (completed.has(step.step.id)) continue;
    if (!step.groupId || !startedGroups.has(step.groupId)) continue;
    const first = previous.steps.find(
      (entry) => entry.groupId === step.groupId,
    );
    if (
      !first ||
      JSON.stringify(groupRuntimeFields(first)) !==
        JSON.stringify(groupRuntimeFields(step))
    )
      throw new AgentError("plan_context_changed");
    const session = run.steps.find(
      (entry) => entry.groupId === step.groupId && entry.session,
    )?.session;
    if (session?.closeout !== "pending")
      throw new AgentError("plan_group_session_lost");
  }
}

function requireGroupMembership(
  previous: AgentPlanSnapshot["steps"][number] | undefined,
  next: AgentPlanSnapshot["steps"][number],
  completed: ReadonlySet<string>,
  startedGroups: ReadonlySet<string | undefined>,
): void {
  if (!previous || previous.groupId === next.groupId) return;
  if (completed.has(next.step.id))
    throw new AgentError("plan_completed_changed");
  if (previous.groupId && startedGroups.has(previous.groupId))
    throw new AgentError("plan_context_changed");
}

function requireCompletedGroups(
  run: AgentPlanRun,
  previous: AgentPlanSnapshot,
  next: AgentPlanSnapshot,
): void {
  for (const group of previous.groups ?? []) {
    if (!run.pauseBoundary?.completedStepIds.includes(group.id)) continue;
    const adopted = next.groups?.find((entry) => entry.id === group.id);
    if (
      JSON.stringify(group.steps.map((step) => step.id)) !==
      JSON.stringify(adopted?.steps.map((step) => step.id))
    )
      throw new AgentError("plan_completed_changed");
  }
}

/**
 * Refuses to change a loop that has already started.
 *
 * @remarks
 * Once a loop resolved its count and ran an iteration, its members, count,
 * mode, condition and session policy are fixed for the run; adopting another
 * version would make the recorded iterations mean something else.
 */
function requireStartedLoops(
  run: AgentPlanRun,
  previous: AgentPlanSnapshot,
  next: AgentPlanSnapshot,
): void {
  for (const record of run.loops ?? []) {
    if (record.count === null) continue;
    const old = previous.plan.nodes.find((node) => node.id === record.id);
    const adopted = next.plan.nodes.find((node) => node.id === record.id);
    const members = (snapshot: AgentPlanSnapshot): string =>
      JSON.stringify(
        snapshot.steps.filter((step) => step.loopId === record.id),
      );
    if (
      JSON.stringify(old) !== JSON.stringify(adopted) ||
      members(previous) !== members(next)
    )
      throw new AgentError("plan_context_changed");
  }
}

/** Keeps the state of every loop of the adopted plan and starts new ones empty. */
function resumedLoops(
  run: AgentPlanRun,
  next: AgentPlanSnapshot,
): AgentPlanRun["loops"] {
  const loops = next.plan.nodes.flatMap((node) =>
    node.type === "loop"
      ? [
          run.loops?.find((entry) => entry.id === node.id) ??
            initialLoopRun(node),
        ]
      : [],
  );
  return loops.length > 0 ? loops : undefined;
}

function requireRetryRouting(
  run: AgentPlanRun,
  previous: AgentPlanSnapshot,
  next: AgentPlanSnapshot,
): void {
  for (const result of run.steps) {
    if (result.status === "succeeded" || !result.session?.retry) continue;
    const original = previous.steps.find((step) => step.step.id === result.id);
    const adopted = next.steps.find((step) => step.step.id === result.id);
    if (
      !original ||
      !adopted ||
      original.provider !== adopted.provider ||
      original.connectionId !== adopted.connectionId ||
      original.model !== adopted.model ||
      original.reasoningEffort !== adopted.reasoningEffort
    )
      throw new AgentError("plan_context_changed");
  }
}

function resumedSteps(
  run: AgentPlanRun,
  next: AgentPlanSnapshot,
): readonly AgentPlanStepResult[] {
  return inPlanSequence(
    next.plan.nodes.filter(isPlanFlowNode),
    planFlowSequence(next.plan).order,
  ).map((node) => {
    const previous = run.steps.find((step) => step.id === node.id);
    if (previous?.status === "succeeded") return previous;
    const snapshot = next.steps.find((step) => step.step.id === node.id);
    return {
      id: node.id,
      groupId: snapshot?.groupId,
      name: snapshot?.name ?? resumedNodeName(node),
      status: "waiting",
      isBlocked: false,
      cancellation: "none",
      output: null,
      error: null,
      ...(previous?.session?.retry ? { session: previous.session } : {}),
    };
  });
}

function resumedNodeName(node: AgentPlanNode): string {
  if (node.type === "loop" || node.type === "script") return node.name;
  return node.type === "agent"
    ? (node.configuration?.name ?? node.type)
    : node.type;
}

/**
 * Validates a saved revision against the completed work of an ended run.
 *
 * @param boundary - The ended run, with the verified completions it keeps as its pause boundary.
 * @param previous - The frozen plan the ended run executed.
 * @param proposed - The saved revision, prepared with the executor's current rights.
 * @returns The snapshot of the new run: completed nodes keep their frozen contracts.
 * @throws {AgentError} `plan_context_changed` for another project or workspace,
 * `plan_completed_changed` when a completed node, its dependencies, its group
 * or a started loop changed.
 *
 * @remarks
 * Unlike a live continuation, no group session is required to still run: a
 * resumed run continues a group session through the adapter's resume or
 * opens a new one, and says which.
 */
export function prepareRecoveredPlan(
  boundary: AgentPlanRun,
  previous: AgentPlanSnapshot,
  proposed: AgentPlanSnapshot,
): AgentPlanSnapshot {
  requireBoundary(boundary, previous, proposed);
  requireCompletedGroups(boundary, previous, proposed);
  for (const step of proposed.steps) {
    const old = previous.steps.find((entry) => entry.step.id === step.step.id);
    if (
      old &&
      old.groupId !== step.groupId &&
      boundary.pauseBoundary?.completedStepIds.includes(step.step.id)
    )
      throw new AgentError("plan_completed_changed");
  }
  requireStartedLoops(boundary, previous, proposed);
  return keptContracts(boundary, previous, proposed);
}

/** Keeps completed contracts and results while applying the validated draft to pending work. */
export function preparePlanContinuation(
  run: AgentPlanRun,
  previous: AgentPlanSnapshot,
  proposed: AgentPlanSnapshot,
): {
  readonly run: AgentPlanRun;
  readonly snapshot: AgentPlanSnapshot;
} {
  requireBoundary(run, previous, proposed);
  requireCompletedGroups(run, previous, proposed);
  requireRetainedGroups(run, previous, proposed);
  requireStartedLoops(run, previous, proposed);
  requireRetryRouting(run, previous, proposed);
  const snapshot = keptContracts(run, previous, proposed);
  const continuation = {
    version: (run.continuation?.version ?? 0) + 1,
    planRevision: proposed.plan.revision,
    adoptedAt: new Date().toISOString(),
  };
  const nextRun = withGroupResults(
    {
      ...run,
      loops: resumedLoops(run, snapshot),
      status: "running",
      pauseBoundary: undefined,
      continuation,
      steps: resumedSteps(run, snapshot),
    },
    snapshot,
  );
  return continueRemotePlanExecution(nextRun, previous, snapshot);
}

/** The proposed snapshot with the frozen contracts of every completed node. */
function keptContracts(
  run: AgentPlanRun,
  previous: AgentPlanSnapshot,
  proposed: AgentPlanSnapshot,
): AgentPlanSnapshot {
  const completed = new Set(run.pauseBoundary?.completedStepIds);
  return {
    ...proposed,
    remoteSteps: proposed.remoteSteps?.map((step) =>
      completed.has(step.step.id)
        ? (previous.remoteSteps?.find(
            (entry) => entry.step.id === step.step.id,
          ) ?? step)
        : step,
    ),
    scripts: proposed.scripts?.map((script) =>
      completed.has(script.step.id)
        ? (previous.scripts?.find(
            (entry) => entry.step.id === script.step.id,
          ) ?? script)
        : script,
    ),
    steps: proposed.steps.map((step) =>
      completed.has(step.step.id)
        ? (previous.steps.find((entry) => entry.step.id === step.step.id) ??
          step)
        : step,
    ),
  };
}
