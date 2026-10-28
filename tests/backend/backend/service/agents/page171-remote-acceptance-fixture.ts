import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { AgentPlanProgressRepository } from "@/backend/database/repositories/agent/AgentPlanProgressRepository";
import { capturePlanExecution } from "@/backend/service/agents/AgentPlanExecutionSnapshot";
import {
  remoteModelCommand,
  remotePlanContract,
} from "@/backend/service/agents/AgentPlanRemoteCommand";
import { AgentPlanRemoteExecution } from "@/backend/service/agents/AgentPlanRemoteExecution";
import { applyRunnerPlanEvent } from "@/backend/service/runner/RunnerPlanEvents";
import { parameterRunFixture } from "./page55-run-fixture";
import { progressRun, progressStep } from "./page162-progress-fixture";
import { remoteTodoStep } from "./page162-remote-fixture";
import type { Mock } from "vitest";
import type { AgentPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";
import type { AgentPlanRun, AgentPlanStep } from "@/definition/AgentPlan";
import type { DatabaseTransaction } from "@/backend/database/Database";
import type { RunnerJob, RunnerMessage } from "@/definition/RunnerProtocol";

/** An isolated progress repository with a controlled database boundary. */
export function progressStore(
  run: AgentPlanRun,
  snapshot: AgentPlanSnapshot,
): {
  readonly repository: AgentPlanProgressRepository;
  readonly execute: Mock<DatabaseTransaction["execute"]>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => undefined);
  const transaction: DatabaseTransaction = {
    query: vi.fn(async () => [
      [JSON.stringify(run), 1, JSON.stringify(snapshot)],
    ]),
    execute,
  };
  return {
    execute,
    repository: new AgentPlanProgressRepository({
      query: transaction.query,
      transaction: async (work) => work(transaction),
    }),
  };
}

function configuredRemoteStep(tool: "codex" | "opencode"): AgentPlanStep {
  const base = remoteTodoStep();
  const configuration = base.configuration;
  if (!configuration?.runnerRoute) throw new Error("Expected a remote route");
  return {
    ...base,
    configuration: {
      ...configuration,
      provider:
        tool === "opencode" ? ("opencode" as const) : ("codex_cli" as const),
      runnerRoute: { ...configuration.runnerRoute, tool },
    },
  };
}

/** Captures one synthetic remote attempt and its authenticated completion. */
export async function remoteCompletion(
  hasGate: boolean,
  tool: "codex" | "opencode" = "codex",
): Promise<{
  readonly run: AgentPlanRun;
  readonly snapshot: AgentPlanSnapshot;
  readonly job: RunnerJob;
  readonly event: Extract<RunnerMessage, { type: "event" }>;
  readonly connectionId: string;
}> {
  const fixture = await parameterRunFixture();
  const target = {
    kind: "remote" as const,
    connectionId: randomUUID(),
    connectionRevision: 1,
    connectionName: "Controlled transport",
    workspaceId: randomUUID(),
    workspaceRevision: 1,
    workspaceName: "Synthetic remote workspace",
    path: "/synthetic-remote",
  };
  const step = {
    ...configuredRemoteStep(tool),
    executionTarget: {
      kind: "remote" as const,
      workspaceId: target.workspaceId,
    },
    ...(hasGate
      ? { completionGate: { version: 1 as const, requiredChecks: ["focused"] } }
      : {}),
  };
  const command = remoteModelCommand(step, {
    version: 1,
    revision: 1,
    workspace: target.path,
    outputBytes: 65536,
    input: "{}",
  });
  const captured = capturePlanExecution(
    {
      ...progressRun([progressStep()]),
      id: randomUUID(),
      planId: fixture.snapshot.plan.id,
    },
    {
      plan: { ...fixture.snapshot.plan, nodes: [step], edges: [] },
      steps: [],
      remoteSteps: [
        {
          step,
          target,
          command,
          inputs: {},
          ...(tool === "opencode"
            ? { acceptanceContract: remotePlanContract(step, []) }
            : {}),
        },
      ],
    },
  );
  const execution = captured.run.steps[0]?.execution;
  if (!execution) throw new Error("Expected a captured remote attempt");
  const job: RunnerJob = {
    jobId: randomUUID(),
    sessionId: randomUUID(),
    status: "completed",
    execution: command,
    plan: {
      runId: captured.run.id,
      planId: captured.run.planId,
      planRevision: captured.run.planRevision,
      stepId: step.id,
      attemptId: execution.attemptId,
    },
  };
  const event: Extract<RunnerMessage, { type: "event" }> = {
    version: 1,
    type: "event",
    eventId: randomUUID(),
    sequence: 1,
    sessionId: job.sessionId,
    job,
    result: {
      output: '{"status":"done","message":"Provider assertion"}',
      closeout: "confirmed",
      exitCode: 0,
      signal: null,
      reason: null,
    },
  };
  return {
    ...captured,
    run: readPlanRun(captured.run),
    job,
    event,
    connectionId: target.connectionId,
  };
}

/** Runs real dispatch and result modules with a controlled runner boundary. */
export function controlledRemoteService(
  world: Awaited<ReturnType<typeof remoteCompletion>>,
  output: string,
): {
  readonly service: AgentPlanRemoteExecution;
  readonly current: () => AgentPlanRun;
} {
  const remote = world.snapshot.remoteSteps?.[0];
  const outcome = world.event.result;
  if (!remote || !outcome)
    throw new Error("Expected a remote command and outcome");
  let current = world.run;
  const service = new AgentPlanRemoteExecution({
    tasks: {
      checklist: async () => {
        throw new Error("No ticket was bound");
      },
    },
    targets: { list: async () => [remote.target], choices: async () => [] },
    access: {
      require: async () => ({
        ...world.snapshot.plan,
        canEdit: true,
        projectName: "Synthetic",
        github: null,
      }),
    },
    provider: {
      catalog: async () => {
        throw new Error("No provider was contacted");
      },
    },
    runs: { find: async () => current },
    runners: {
      availability: async () => null,
      catalog: async () => undefined,
      supportsPagesAccess: () => false,
      supportsOpenCode: () => true,
      supportsExactResultPayload: () => true,
      supportsAssetFiles: () => false,
      ready: async () => [],
      cancel: async () => {
        throw new Error("No cancellation was requested");
      },
      progress: async () => undefined,
      historyPending: async () => 0,
      contact: () => {
        throw new Error("No contact status was requested");
      },
      enqueue: async (userId, connectionId, plan, execution) => {
        if (
          !plan ||
          !execution ||
          userId !== world.run.userId ||
          connectionId !== world.connectionId
        )
          throw new Error("Unexpected remote claim");
        const job = { ...world.job, plan, execution };
        const event = { ...world.event, job, result: { ...outcome, output } };
        current = applyRunnerPlanEvent(
          { connectionId, job, event },
          current,
          world.snapshot,
        ).run;
        return job;
      },
    },
  });
  vi.spyOn(service, "validateModel").mockResolvedValue();
  return { service, current: () => current };
}
