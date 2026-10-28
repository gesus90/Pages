import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";

import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { readPlanDiagnostic } from "@/backend/service/agents/AgentPlanDiagnosticRead";
import { runDetail } from "@/backend/service/agents/AgentPlanOperationViews";
import { capturePlanExecution } from "@/backend/service/agents/AgentPlanExecutionSnapshot";
import { applyRunnerPlanEvent } from "@/backend/service/runner/RunnerPlanEvents";

import { parameterRunFixture } from "./page55-run-fixture";
import { progressRun, progressStep } from "./page162-progress-fixture";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";
import type { RunnerExecution } from "@/definition/RunnerExecution";
import type { RunnerJob, RunnerMessage } from "@/definition/RunnerProtocol";

type PlanEvent = Extract<RunnerMessage, { type: "event" }>;
type Result = NonNullable<PlanEvent["result"]>;

interface RemoteScriptWorld {
  readonly run: AgentPlanRun;
  readonly snapshot: ReturnType<typeof capturePlanExecution>["snapshot"];
  readonly connectionId: string;
  readonly job: RunnerJob;
}

async function remoteScript(hasOutput: boolean): Promise<RemoteScriptWorld> {
  const fixture = await parameterRunFixture();
  const step: AgentPlanScript = {
    id: "agent",
    type: "script",
    name: "Synthetic remote script",
    x: 0,
    y: 0,
    interpreterProfileId: "python",
    content: "print('synthetic')",
    inputs: [],
    outputs: hasOutput ? [{ name: "result", type: "text" }] : [],
    timeoutSeconds: 60,
    bindings: {},
  };
  const target = {
    kind: "remote" as const,
    connectionId: randomUUID(),
    connectionRevision: 1,
    connectionName: "Synthetic",
    workspaceId: randomUUID(),
    workspaceRevision: 1,
    workspaceName: "Synthetic",
    path: "/synthetic",
  };
  const command: RunnerExecution = {
    version: 1,
    revision: 1,
    workspace: target.path,
    timeoutSeconds: 60,
    outputBytes: 65536,
    input: "{}",
    hasOutput,
    program: {
      kind: "script",
      source: step.content,
      interpreter: {
        id: "python",
        name: "Python",
        path: "/usr/bin/python3",
        digest: "a".repeat(64),
        version: "synthetic",
      },
    },
  };
  const captured = capturePlanExecution(
    {
      ...progressRun([progressStep()]),
      id: randomUUID(),
      planId: fixture.snapshot.plan.id,
    },
    {
      plan: { ...fixture.snapshot.plan, nodes: [step], edges: [] },
      steps: [],
      remoteSteps: [{ step, target, command, inputs: {} }],
    },
  );
  const run = readPlanRun(captured.run);
  const execution = run.steps[0]?.execution;
  if (!execution) throw new Error("Synthetic execution is missing");
  const job: RunnerJob = {
    jobId: randomUUID(),
    sessionId: randomUUID(),
    status: "completed",
    execution: command,
    plan: {
      planId: run.planId,
      runId: run.id,
      stepId: step.id,
      planRevision: run.planRevision,
      attemptId: execution.attemptId,
    },
  };
  return {
    run,
    snapshot: captured.snapshot,
    connectionId: target.connectionId,
    job,
  };
}

function applyResult(
  world: RemoteScriptWorld,
  result: Result,
  status: "completed" | "failed" = "completed",
): AgentPlanRun {
  const job: RunnerJob = { ...world.job, status };
  const event: PlanEvent = {
    version: 1,
    type: "event",
    eventId: randomUUID(),
    sequence: 1,
    sessionId: job.sessionId,
    job,
    result,
  };
  return applyRunnerPlanEvent(
    { connectionId: world.connectionId, job, event },
    world.run,
    world.snapshot,
  ).run;
}

async function diagnostic(run: AgentPlanRun): Promise<unknown> {
  return readPlanDiagnostic({ run: async () => run }, run.userId, {
    planId: run.planId,
    runId: run.id,
    stepId: "agent",
  });
}

const SUCCESS: Result = {
  output: "synthetic stdout",
  stderr: "synthetic warning",
  closeout: "confirmed",
  exitCode: 0,
  signal: null,
  reason: null,
};

it("keeps a successful remote script's stdout and stderr separately readable", async () => {
  const run = applyResult(await remoteScript(true), SUCCESS);
  expect(await diagnostic(readPlanRun(run))).toMatchObject({
    diagnostic: {
      status: "succeeded",
      interpreterProfileId: "python",
      timingBasis: "remote_observation",
      result: { text: "synthetic stdout" },
      stdout: { text: "synthetic stdout" },
      stderr: { text: "synthetic warning", completeness: "unknown" },
    },
  });
});

it("includes the recorded remote observation times in run and step status", async () => {
  const run = applyResult(await remoteScript(true), SUCCESS);
  const remote = run.steps[0]?.remote;
  if (!remote) throw new Error("Remote progress is missing");
  expect(runDetail({ ...run, status: "succeeded" })).toMatchObject({
    endedAt: remote.endedAt,
    steps: [
      { stepId: "agent", startedAt: remote.startedAt, endedAt: remote.endedAt },
    ],
  });
});

it("records diagnostic stdout without creating an undeclared result binding", async () => {
  const run = applyResult(await remoteScript(false), SUCCESS);
  expect(run.steps[0]?.output).toBeNull();
  expect(await diagnostic(readPlanRun(run))).toMatchObject({
    diagnostic: {
      result: { text: null },
      stdout: { text: "synthetic stdout" },
      stderr: { text: "synthetic warning" },
    },
  });
});

it.each([
  [{ exitCode: 7, signal: null, reason: "exit" }, "plan_script_exit"],
  [{ exitCode: null, signal: "SIGTERM", reason: "exit" }, "plan_script_signal"],
  [{ exitCode: null, signal: null, reason: "timeout" }, "plan_script_timeout"],
  [{ exitCode: null, signal: null, reason: "spawn" }, "plan_script_spawn"],
  [
    { exitCode: null, signal: null, reason: "output_limit" },
    "plan_script_output_limit",
  ],
] as const)(
  "assigns a remote %s failure to the script",
  async (failure, code) => {
    const run = applyResult(
      await remoteScript(true),
      { ...SUCCESS, ...failure },
      "failed",
    );
    expect(await diagnostic(readPlanRun(run))).toMatchObject({
      diagnostic: {
        status: "failed",
        error: code,
        stdout: { text: "synthetic stdout" },
      },
    });
  },
);

it("allows empty stdout when no output is declared and stderr only warns", async () => {
  const run = applyResult(await remoteScript(false), {
    ...SUCCESS,
    output: "",
  });
  expect(await diagnostic(readPlanRun(run))).toMatchObject({
    diagnostic: {
      status: "succeeded",
      stdout: { text: "" },
      stderr: { text: "synthetic warning" },
    },
  });
});

it("marks an interrupted remote output partial and names the timeout action", async () => {
  const run = applyResult(
    await remoteScript(true),
    { ...SUCCESS, exitCode: null, reason: "timeout" },
    "failed",
  );
  expect(await diagnostic(readPlanRun(run))).toMatchObject({
    diagnostic: {
      stdout: { text: "synthetic stdout", completeness: "partial" },
      nextAction:
        "Inspect the timeout and diagnostic output before an explicit retry.",
    },
  });
});

it("marks captured remote output filtered when Pages masks a credential-shaped value", async () => {
  const sensitive = ["password", "=", "synthetic-value"].join("");
  const run = applyResult(await remoteScript(false), {
    ...SUCCESS,
    output: sensitive,
    stderr: sensitive,
  });
  const result = await diagnostic(readPlanRun(run));
  expect(result).toMatchObject({
    diagnostic: {
      stdout: { text: "[redacted]", isFiltered: true },
      stderr: { text: "[redacted]", isFiltered: true },
    },
  });
  expect(JSON.stringify(result)).not.toContain("synthetic-value");
});

it("uses a historical script result as an uncertain stdout only for a script", async () => {
  const run = applyResult(await remoteScript(true), SUCCESS);
  const step = run.steps[0];
  if (!step?.remote || !step.execution)
    throw new Error("Synthetic step is missing");
  const legacy = {
    ...run,
    steps: [{ ...step, remote: { ...step.remote, stdout: undefined } }],
  };
  expect(await diagnostic(readPlanRun(legacy))).toMatchObject({
    diagnostic: {
      stdout: { text: "synthetic stdout", completeness: "unknown" },
    },
  });
  const agent = {
    ...legacy,
    steps: [
      {
        ...legacy.steps[0],
        execution: {
          ...step.execution,
          modelAccess: { ...step.execution.modelAccess, provider: "codex_cli" },
        },
      },
    ],
  };
  expect(await diagnostic(readPlanRun(agent))).toMatchObject({
    diagnostic: { stdout: { text: null, completeness: "missing" } },
  });
});
