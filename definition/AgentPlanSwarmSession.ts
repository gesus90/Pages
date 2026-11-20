import { storedAgentAccessMode } from "./AgentAccessMode";
import { ACP_PROVIDERS, acpRunOptions } from "./AgentConfiguration";
import { planSwarmWorkerList } from "./AgentPlanSwarm";
import { agentSwarmWorkerStep } from "./AgentPlanSwarmOperations";

import type { AcpProviderId } from "./AgentConfiguration";
import type { AgentPlanStepResult, AgentPlanStepStatus } from "./AgentPlan";
import type { AgentPlanAgentTodo } from "./AgentPlanAgentTodos";
import type { AgentPlanSessionRecord } from "./AgentPlanSession";
import type { AgentPlanSwarm, AgentPlanSwarmAccess } from "./AgentPlanSwarm";
import type {
  AgentPlanSwarmSessionView,
  AgentPlanSwarmWorkerView,
} from "./AgentPlanSwarmRun";

/**
 * Where one session of a swarm stands, in the five words of its card.
 * @remarks
 * `waiting` is a session that has not started or waits for its next subtask.
 */
export type PlanSwarmSessionStatus =
  "waiting" | "running" | "succeeded" | "failed" | "cancelled";

/** The main model or one helper of a swarm node, as the console lists it. */
export interface PlanSwarmSessionEntry {
  readonly role: "main" | "worker";
  /** `H1` … `H10` for a helper; `null` for the main model. */
  readonly workerId: string | null;
  /** The step of the session: the swarm node itself, or `<node>::H<n>`. */
  readonly stepId: string;
  readonly status: PlanSwarmSessionStatus;
  /** The runner and model as the run recorded them; empty when none is known. */
  readonly provider: string;
  readonly model: string;
  /** Why a helper did not start or failed; `null` otherwise. */
  readonly reason: string | null;
  /**
   * The step the console shows for the session.
   * @remarks
   * It carries only what the swarm recorded for this session; a session that
   * did not start has no `session` record.
   */
  readonly step: AgentPlanStepResult;
}

const STEP_STATUS: Readonly<
  Record<PlanSwarmSessionStatus, AgentPlanStepStatus>
> = {
  waiting: "running",
  running: "running",
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
};

function isAcpProviderId(provider: string): provider is AcpProviderId {
  return ACP_PROVIDERS.some((entry) => entry === provider);
}

/** Maps what the node did to the word of a session that ran inside it. */
function endedStatus(node: AgentPlanStepResult): PlanSwarmSessionStatus {
  if (node.status === "cancelled") return "cancelled";
  if (node.status === "failed") return "failed";
  return "succeeded";
}

function mainStatus(node: AgentPlanStepResult): PlanSwarmSessionStatus {
  if (node.status === "running") return "running";
  if (node.status === "succeeded") return "succeeded";
  if (node.status === "failed") return "failed";
  if (node.status === "cancelled") return "cancelled";
  return "waiting";
}

function workerStatus(
  node: AgentPlanStepResult,
  worker: AgentPlanSwarmWorkerView,
): PlanSwarmSessionStatus {
  if (worker.status === "failed") return "failed";
  if (worker.status === "busy" || worker.status === "starting")
    return node.status === "running" ? "running" : endedStatus(node);
  if (worker.status === "not_started") return "waiting";
  if (!worker.session) return "waiting";
  if (node.status === "running" && worker.session.endedAt === null)
    return "waiting";
  return node.status === "cancelled" ? "cancelled" : "succeeded";
}

/** The record the console reads session facts from; built only from the stored session. */
function sessionRecord(input: {
  readonly provider: string;
  readonly model: string;
  readonly access: AgentPlanSwarmAccess | null;
  readonly session: AgentPlanSwarmSessionView | undefined;
}): AgentPlanSessionRecord | null {
  const { provider, session } = input;
  if (!session || !isAcpProviderId(provider)) return null;
  const mode = storedAgentAccessMode(input.access);
  return {
    runner: provider,
    mode: "interactive",
    instanceId: session.instanceId,
    attemptId: session.attemptId,
    sessionId: null,
    processId: null,
    startedAt: session.startedAt,
    turnEndedAt: session.endedAt,
    endedAt: session.endedAt,
    exit: null,
    closeout: session.endedAt === null ? "pending" : "confirmed",
    leftoverProcesses: null,
    resultCode: null,
    requested: {
      runner: provider,
      connectionId: session.connectionId,
      connectionName: "",
      model: input.model,
      reasoningEffort: session.reasoningEffort,
      options: mode === null ? null : acpRunOptions(mode, 0),
      unattended: "",
      mcp: true,
      directory: session.directory,
    },
    effective: null,
    definition: null,
    contract: null,
    acceptance: null,
    events: [],
  };
}

/** When the CLI last reported the list: the newest time any entry carries. */
function latestUpdate(todos: readonly AgentPlanAgentTodo[]): string {
  return (
    todos
      .map((todo) => todo.updatedAt)
      .sort()
      .at(-1) ?? ""
  );
}

function sessionStep(input: {
  readonly stepId: string;
  readonly name: string;
  readonly status: PlanSwarmSessionStatus;
  readonly error: string | null;
  readonly record: AgentPlanSessionRecord | null;
  readonly todos: readonly AgentPlanAgentTodo[];
}): AgentPlanStepResult {
  const { record } = input;
  return {
    id: input.stepId,
    name: input.name,
    status: STEP_STATUS[input.status],
    isBlocked: false,
    cancellation: "none",
    output: null,
    error: input.error,
    session: record,
    ...(record?.attemptId && input.todos.length > 0
      ? {
          agentTodos: {
            attemptId: record.attemptId,
            todos: input.todos,
            updatedAt: latestUpdate(input.todos),
          },
        }
      : {}),
  };
}

/**
 * Lists the sessions of a swarm node in a run: the main model first, then H1, H2 and on.
 * @param node - The result of the swarm node.
 * @returns Every session, also a helper that has not started; empty for a node without a swarm view.
 * @remarks
 * Nothing is invented: a session without a stored attempt has no record, so
 * the console shows no history and no facts for it. The server lists the same
 * entries to authorize the read of a session, so the browser and the server
 * never disagree about which attempts belong to the node.
 */
export function planSwarmSessionEntries(
  node: AgentPlanStepResult,
): readonly PlanSwarmSessionEntry[] {
  const { swarm } = node;
  if (!swarm) return [];
  const { main } = swarm;
  const mainEntryStatus = mainStatus(node);
  const entries: PlanSwarmSessionEntry[] = [
    {
      role: "main",
      workerId: null,
      stepId: node.id,
      status: mainEntryStatus,
      provider: main.provider,
      model: main.model,
      reason: null,
      step: sessionStep({
        stepId: node.id,
        name: node.name,
        status: mainEntryStatus,
        error: node.error,
        record: sessionRecord({
          provider: main.provider,
          model: main.model,
          access: null,
          session: main.session,
        }),
        todos: main.todos,
      }),
    },
  ];
  for (const worker of swarm.workers) {
    const status = workerStatus(node, worker);
    const stepId = agentSwarmWorkerStep(node.id, worker.id);
    entries.push({
      role: "worker",
      workerId: worker.id,
      stepId,
      status,
      provider: worker.provider,
      model: worker.model,
      reason: worker.reason,
      step: sessionStep({
        stepId,
        name: worker.id,
        status,
        error: worker.reason,
        record: sessionRecord({
          provider: worker.provider,
          model: worker.model,
          access: worker.access,
          session: worker.session,
        }),
        todos: worker.todos,
      }),
    });
  }
  return entries;
}

function configuredEntry(input: {
  readonly workerId: string | null;
  readonly stepId: string;
  readonly name: string;
  readonly model: { readonly provider: string; readonly model: string } | null;
}): PlanSwarmSessionEntry {
  return {
    role: input.workerId === null ? "main" : "worker",
    workerId: input.workerId,
    stepId: input.stepId,
    status: "waiting",
    provider: input.model?.provider ?? "",
    model: input.model?.model ?? "",
    reason: null,
    step: sessionStep({
      stepId: input.stepId,
      name: input.name,
      status: "waiting",
      error: null,
      record: null,
      todos: [],
    }),
  };
}

/**
 * Lists the sessions a swarm node is configured with, for a node that did not run yet.
 * @param swarm - The swarm as the plan defines it.
 * @returns The main model first, then H1, H2 and on; every session waits and has no history.
 * @remarks
 * The console shows these before the node starts, so the helpers are known
 * before their first session opens.
 */
export function planSwarmConfiguredEntries(
  swarm: AgentPlanSwarm,
): readonly PlanSwarmSessionEntry[] {
  const helpers = planSwarmWorkerList(swarm.workers).map((worker, index) => {
    const workerId = `H${String(index + 1)}`;
    return configuredEntry({
      workerId,
      stepId: agentSwarmWorkerStep(swarm.id, workerId),
      name: workerId,
      model: worker.model,
    });
  });
  return [
    configuredEntry({
      workerId: null,
      stepId: swarm.id,
      name: swarm.name ?? swarm.id,
      model: swarm.main.model,
    }),
    ...helpers,
  ];
}
