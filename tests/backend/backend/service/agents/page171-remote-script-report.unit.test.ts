import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";

import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { capturePlanExecution } from "@/backend/service/agents/AgentPlanExecutionSnapshot";
import { applyRunnerPlanEvent } from "@/backend/service/runner/RunnerPlanEvents";

import { parameterRunFixture } from "./page55-run-fixture";
import { progressRun, progressStep } from "./page162-progress-fixture";

import type { AgentPlanScript } from "@/definition/AgentPlanScript";
import type { RunnerExecution } from "@/definition/RunnerExecution";
import type { RunnerJob, RunnerMessage } from "@/definition/RunnerProtocol";

function script(policy: "report" | "gate"): AgentPlanScript {
  return {
    id: "agent",
    type: "script",
    name: "Synthetic review",
    x: 0,
    y: 0,
    interpreterProfileId: "python",
    content: "print('synthetic')",
    inputs: [],
    outputs: [{ name: "report", type: "text", policy }],
    timeoutSeconds: 60,
    bindings: {},
  };
}

function remoteJob(
  run: ReturnType<typeof readPlanRun>,
  step: AgentPlanScript,
  command: RunnerExecution,
): RunnerJob {
  const execution = run.steps[0]?.execution;
  if (!execution) throw new Error("Expected a remote execution");
  return {
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
}

function expectSensitiveReportRejected(
  input: Parameters<typeof applyRunnerPlanEvent>[0],
  run: Parameters<typeof applyRunnerPlanEvent>[1],
  snapshot: Parameters<typeof applyRunnerPlanEvent>[2],
): void {
  const event = input.event;
  if (!event?.result) throw new Error("Expected a synthetic outcome");
  const sensitive = ["password", "=", "synthetic-value"].join("");
  const output = JSON.stringify({
    status: "failed",
    summary: "Synthetic",
    checks: [{ name: "unit", status: "failed", detail: sensitive }],
  });
  const filtered = applyRunnerPlanEvent(
    { ...input, event: { ...event, result: { ...event.result, output } } },
    run,
    snapshot,
  );
  expect(filtered.run.steps[0]).toMatchObject({
    status: "failed",
    error: "plan_script_result_sensitive",
  });
  expect(filtered.run.steps[0]?.output).not.toContain("synthetic-value");
  expect(filtered.checkpoint).toBeUndefined();
}

it.each(["report", "gate"] as const)(
  "applies the %s policy to a remote runner completion before checkpointing",
  async (policy) => {
    const fixture = await parameterRunFixture();
    const step = script(policy);
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
      hasOutput: true,
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
    const job = remoteJob(run, step, command);
    const output = JSON.stringify({
      status: "failed",
      summary: "Test failed",
      checks: [{ name: "unit", status: "failed", detail: "exit 1" }],
    });
    const event: Extract<RunnerMessage, { type: "event" }> = {
      version: 1,
      type: "event",
      eventId: randomUUID(),
      sequence: 1,
      sessionId: job.sessionId,
      job,
      result: {
        output,
        stderr: "warning only",
        closeout: "confirmed",
        exitCode: 0,
        signal: null,
        reason: null,
      },
    };
    const applied = applyRunnerPlanEvent(
      { connectionId: target.connectionId, job, event },
      run,
      captured.snapshot,
    );
    expect(applied.run.steps[0]).toMatchObject({
      status: policy === "report" ? "succeeded" : "failed",
      output,
      report: { status: "failed", failedCount: 1 },
      remote: { stderr: "warning only", closeout: "confirmed" },
    });
    expect(applied.checkpoint?.result.report?.status).toBe(
      policy === "report" ? "failed" : undefined,
    );
    expect(readPlanRun(applied.run).steps[0]?.report?.status).toBe("failed");
    expectSensitiveReportRejected(
      { connectionId: target.connectionId, job, event },
      run,
      captured.snapshot,
    );
  },
);
