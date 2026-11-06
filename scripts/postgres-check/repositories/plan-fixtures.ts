import {
  appendSessionHistoryChunks,
  prepareSessionHistoryChunks,
} from "@/backend/database/repositories/agent/AgentSessionHistoryChunks";
import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { readPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import { call } from "./world";

import type { Database } from "@/backend/database/Database";
import type { AgentSessionEvent } from "@/definition/AgentSessionJournal";
import type { RepositoryStep } from "./world";
import type { AgentPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";
import type {
  AgentPlan,
  AgentPlanRun,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { AgentProfile } from "@/definition/AgentProfile";
import type { AgentPlanCheckpointInput } from "@/definition/AgentPlanRecovery";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type { AgentPlanStepExecution } from "@/definition/AgentPlanExecution";

export const OWNER = "user-plan-owner";
export const OTHER_USER = "user-plan-other";
export const PROJECT = "project-plans";
export const WORKSPACE = "workspace-plans";
export const AGENT_PROFILE = "profile-plans";
export const DIGEST = "a".repeat(64);
export const OTHER_DIGEST = "b".repeat(64);
export const STARTED_AT = "2026-03-01T08:00:00.000Z";
export const PLAN_SCRIPT_DIRECTORY = "/nonexistent/pages-plan-scripts";
export const ATTEMPT = "11111111-1111-4111-8111-111111111111";

const FLOW_PORTS = { fromPort: "flow-out", toPort: "flow-in" } as const;
const ONE_HOUR_MS = 3_600_000;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/**
 * A plan with one agent node between start and end.
 *
 * @param id - The plan.
 * @param changes - What differs from the plain plan.
 * @returns The plan.
 */
export function planFixture(
  id: string,
  changes: Partial<AgentPlan> = {},
): AgentPlan {
  return {
    id,
    name: `Plan ${id}`,
    ownerId: OWNER,
    workspaceId: WORKSPACE,
    projectId: PROJECT,
    usage: "workspace",
    sharing: { isGlobal: true, targets: [], operator: "or" },
    globals: {},
    revision: 1,
    nodes: [
      { id: "start", type: "start", x: 0, y: 0 },
      {
        id: "review",
        type: "agent",
        x: 320,
        y: 0,
        agentId: AGENT_PROFILE,
        personalAgentId: null,
        instruction: "Prüfe das Ticket.",
        bindings: {},
      },
      { id: "end", type: "end", x: 640, y: 0 },
    ],
    edges: [
      { from: "start", to: "review", ...FLOW_PORTS },
      { from: "review", to: "end", ...FLOW_PORTS },
    ],
    ...changes,
  };
}

/**
 * The private basis of a run of a plan; the repositories only read its plan and step list.
 *
 * @param plan - The frozen plan.
 * @returns The basis.
 */
export function snapshotFixture(plan: AgentPlan): AgentPlanSnapshot {
  return readPlanSnapshot({
    plan,
    steps: [
      {
        step: { id: "review", type: "agent", agentId: AGENT_PROFILE },
        provider: "openrouter",
        prepared: { directory: null, workspace: null },
        template: {},
      },
    ],
    scripts: [{ workspace: { path: PLAN_SCRIPT_DIRECTORY } }],
  });
}

/**
 * One node result.
 *
 * @param id - The node.
 * @param changes - What differs from a waiting node.
 * @returns The result.
 */
export function stepFixture(
  id: string,
  changes: Partial<AgentPlanStepResult> = {},
): AgentPlanStepResult {
  return {
    id,
    name: id,
    status: "waiting",
    isBlocked: false,
    cancellation: "none",
    output: null,
    error: null,
    ...changes,
  };
}

/**
 * A running run of a plan.
 *
 * @param id - The run.
 * @param planId - The plan.
 * @param changes - What differs from a run that just started.
 * @returns The public record.
 */
export function runFixture(
  id: string,
  planId: string,
  changes: Partial<AgentPlanRun> = {},
): AgentPlanRun {
  return {
    id,
    planId,
    planName: `Plan ${planId}`,
    userId: OWNER,
    startedAt: STARTED_AT,
    planRevision: 1,
    status: "running",
    stopRequested: false,
    steps: [stepFixture("review")],
    ...changes,
  };
}

/**
 * The completion of the agent node of a run.
 *
 * @param run - The run after the completion.
 * @param snapshot - Its stored basis.
 * @returns The checkpoint input, with `done` as the result.
 */
export function checkpointFixture(
  run: AgentPlanRun,
  snapshot: AgentPlanSnapshot,
): AgentPlanCheckpointInput {
  return {
    schemaVersion: 1,
    runId: run.id,
    planId: run.planId,
    planRevision: run.planRevision,
    stepId: "review",
    completedAt: STARTED_AT,
    snapshotDigest: planContentDigest(snapshot),
    workflow: { engine: "pages", runId: null },
    completedStepIds: ["review"],
    pendingStepIds: [],
    dependencies: [],
    inputs: [],
    configurationDigest: DIGEST,
    workspaceDigest: OTHER_DIGEST,
    context: {
      groupId: null,
      agentId: AGENT_PROFILE,
      agentRevision: 1,
      connectionId: null,
      provider: null,
      model: null,
      workspaceIds: [WORKSPACE],
    },
    dispatchedPromptDigest: null,
    result: {
      output: "done",
      isOutputReduced: false,
      outputDigest: planContentDigest("done"),
      technical: { resultCode: 0, closeout: "confirmed" },
      acceptance: null,
    },
    session: null,
  };
}

/**
 * A session record of a node.
 *
 * @param changes - What differs from a session that is about to start.
 * @returns The record.
 */
export function sessionFixture(
  changes: Partial<AgentPlanSessionRecord> = {},
): AgentPlanSessionRecord {
  return {
    runner: "codex_cli",
    mode: "one_shot",
    instanceId: "instance-plans",
    attemptId: ATTEMPT,
    sessionId: null,
    processId: null,
    startedAt: null,
    turnEndedAt: null,
    endedAt: null,
    exit: null,
    closeout: "not_needed",
    leftoverProcesses: null,
    resultCode: null,
    requested: {
      runner: "codex_cli",
      connectionId: "connection-plans",
      connectionName: "Verbindung",
      model: "model-a",
      reasoningEffort: null,
      options: null,
      unattended: "never",
      mcp: false,
      directory: null,
    },
    effective: null,
    definition: null,
    contract: null,
    acceptance: null,
    events: [],
    ...changes,
  };
}

/**
 * The frozen execution of a node on a remote machine.
 *
 * @param runId - The run.
 * @param planId - The plan.
 * @returns The execution.
 */
export function remoteExecutionFixture(
  runId: string,
  planId: string,
): AgentPlanStepExecution {
  return {
    schemaVersion: 1,
    planId,
    runId,
    stepId: "review",
    attemptId: ATTEMPT,
    planRevision: 1,
    target: {
      kind: "remote",
      connectionId: "connection-plans",
      connectionRevision: 1,
      connectionName: "Verbindung",
      workspaceId: WORKSPACE,
      workspaceRevision: 1,
      workspaceName: "Arbeitskopie",
      path: "/srv/plans",
    },
    workspace: { id: WORKSPACE, path: "/srv/plans", revision: 1 },
    modelAccess: {
      connectionId: "connection-plans",
      connectionName: "Verbindung",
      provider: "codex_cli",
      model: "model-a",
      reasoningEffort: null,
    },
  };
}

/**
 * An administrator agent.
 *
 * @param id - The profile.
 * @param changes - What differs from the plain agent.
 * @returns The profile, not saved yet.
 */
export function profileFixture(
  id: string,
  changes: Partial<AgentProfile> = {},
): AgentProfile {
  return {
    id,
    name: `Agent ${id}`,
    connectionId: "connection-plans",
    model: "model-a",
    reasoningEffort: null,
    isActive: true,
    purposes: ["agent"],
    targets: [],
    configuration: emptyAgentConfiguration("person"),
    ...changes,
  };
}

function withoutClock(input: unknown): unknown {
  if (typeof input === "string")
    return ISO_TIME.test(input) &&
      Math.abs(Date.parse(input) - Date.now()) < ONE_HOUR_MS
      ? "<clock>"
      : input;
  if (Array.isArray(input)) return input.map(withoutClock);
  if (typeof input === "object" && input !== null)
    return Object.fromEntries(
      Object.entries(input).map(([key, item]) => [key, withoutClock(item)]),
    );
  return input;
}

/**
 * A step whose result holds the time of the server clock in the format of the code.
 *
 * @param name - The method or function it calls.
 * @param run - The call.
 * @returns The step.
 *
 * @remarks
 * Only a time of the last hour counts as the clock, so the fixed times of the
 * fixtures are still compared.
 */
export function callAtAnyTime(
  name: string,
  run: RepositoryStep["run"],
): RepositoryStep {
  return call(name, async (world) => withoutClock(await run(world)));
}

/** Synchronizes immutable history before entering the receipt transaction. */
export async function appendPreparedHistory(
  database: Database,
  planId: string,
  owner: { readonly attemptId: string; readonly launchId: string },
  events: readonly AgentSessionEvent[],
): Promise<void> {
  const prepared = await prepareSessionHistoryChunks(database, planId, events);
  await database.transaction((transaction) =>
    appendSessionHistoryChunks(transaction, owner, events, prepared),
  );
}
