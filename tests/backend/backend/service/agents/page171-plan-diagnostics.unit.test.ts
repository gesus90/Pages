import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { readPlanDiagnostic } from "@/backend/service/agents/AgentPlanDiagnosticRead";
import {
  beginIteration,
  initialLoopRun,
  patchIterationNode,
} from "@/backend/service/agents/loop/AgentPlanLoopRecord";
import { emptyPlanLoop } from "@/definition/AgentPlanLoop";

import { patchRecoveryStep, recoveryFixture } from "./page84-recovery-fixture";
import { PlanWorld } from "./plan-operation-world";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanScriptRun } from "@/definition/AgentPlanScript";

function script(run: AgentPlanRun): AgentPlanScriptRun {
  return {
    attemptId: "17b99dfa-d3fb-470a-b204-8dcaee627667",
    instanceId: "5b7f02ca-5f61-4e3c-bba2-19e6cd07494d",
    interpreterProfileId: "synthetic-python",
    directory: "/synthetic",
    userId: run.userId,
    uid: 1000,
    gid: 1000,
    processId: 99,
    startedAt: "2026-10-28T00:00:00.000Z",
    endedAt: "2026-10-28T00:00:01.500Z",
    exitCode: 7,
    signal: null,
    failure: "exit",
    closeout: "confirmed",
    stdout: "synthetic output",
    stderr: "synthetic warning",
  };
}

it("retains prior provider attempt keys and failure times without native session identities", async () => {
  const fixture = await recoveryFixture();
  const session = fixture.failed.steps.find((step) => step.id === "a")?.session;
  if (!session) throw new Error("Missing fixture session");
  const run = patchRecoveryStep(fixture.failed, "a", {
    session: {
      ...session,
      retry: {
        state: "completed",
        reason: "transient",
        nextAttemptAt: null,
        resetAt: null,
        attempts: [
          {
            attemptId: "previous",
            sessionId: "private-native-session",
            endedAt: "2026-10-28T00:00:00Z",
            code: "provider_unavailable",
          },
        ],
      },
    },
  });
  const result = await readPlanDiagnostic(
    { run: async () => run },
    run.userId,
    {
      planId: run.planId,
      runId: run.id,
      stepId: "a",
    },
  );
  expect(result).toMatchObject({
    diagnostic: {
      retryAttempts: [
        {
          attemptId: "previous",
          endedAt: "2026-10-28T00:00:00Z",
          code: "provider_unavailable",
        },
      ],
    },
  });
  expect(JSON.stringify(result)).not.toContain("private-native-session");
});

it("reports a failed script at its source with separate complete streams and exit evidence", async () => {
  const fixture = await recoveryFixture();
  const run = patchRecoveryStep(fixture.failed, "b", {
    error: "plan_script_exit",
    output: "synthetic output",
    script: script(fixture.failed),
  });
  const plans = { run: vi.fn(async () => run) };
  const result = await readPlanDiagnostic(plans, run.userId, {
    planId: run.planId,
    runId: run.id,
    stepId: "b",
  });

  expect(result).toMatchObject({
    diagnostic: {
      runId: run.id,
      stepId: "b",
      status: "failed",
      error: "plan_script_exit",
      exitCode: 7,
      durationMs: 1500,
      closeout: "confirmed",
      stdout: { text: "synthetic output", completeness: "complete" },
      stderr: { text: "synthetic warning", completeness: "complete" },
      result: { text: "synthetic output", completeness: "complete" },
    },
  });
  expect(plans.run).toHaveBeenCalledWith(run.userId, run.id);
  expect(JSON.stringify(result)).not.toContain("instanceId");
  expect(JSON.stringify(result)).not.toContain("processId");
});

it("marks timeout output partial and redacts credential-shaped diagnostics", async () => {
  const fixture = await recoveryFixture();
  const run = patchRecoveryStep(fixture.failed, "b", {
    error: "plan_script_timeout",
    script: {
      ...script(fixture.failed),
      failure: "timeout",
      stdout: null,
      stderr: `password=${"synthetic-value"}`,
    },
  });
  const result = await readPlanDiagnostic(
    { run: async () => run },
    run.userId,
    {
      planId: run.planId,
      runId: run.id,
      stepId: "b",
    },
  );

  expect(result).toMatchObject({
    diagnostic: {
      stdout: { text: null, completeness: "missing" },
      stderr: { text: "[redacted]", completeness: "partial", isFiltered: true },
    },
  });
  if (!("diagnostic" in result)) throw new Error("Expected diagnostic");
  expect(result.diagnostic.nextAction).toContain("timeout");
  expect(JSON.stringify(result)).not.toContain("synthetic-value");
});

it("names the required runner upgrade for a legacy CLI result", async () => {
  const fixture = await recoveryFixture();
  const run = patchRecoveryStep(fixture.failed, "b", {
    error: "plan_runner_payload_update_required",
    script: undefined,
    session: undefined,
  });
  const result = await readPlanDiagnostic(
    { run: async () => run },
    run.userId,
    {
      planId: run.planId,
      runId: run.id,
      stepId: "b",
    },
  );
  if (!("diagnostic" in result)) throw new Error("Expected diagnostic");
  expect(result.diagnostic.nextAction).toContain("Runner to 1.13.0");
});

it.each([
  ["opencode_acceptance_unavailable", "plan and ticket access"],
  ["opencode_acceptance_contract_unavailable", "current saved plan"],
  ["opencode_acceptance_interrupted", "reviewed recovery"],
] as const)(
  "explains the remote assessment blocker %s",
  async (error, action) => {
    const fixture = await recoveryFixture();
    const run = patchRecoveryStep(fixture.failed, "b", {
      error,
      script: undefined,
      session: undefined,
    });
    const result = await readPlanDiagnostic(
      { run: async () => run },
      run.userId,
      { planId: run.planId, runId: run.id, stepId: "b" },
    );
    if (!("diagnostic" in result)) throw new Error("Expected diagnostic");
    expect(result.diagnostic.failure).toBe(error);
    expect(result.diagnostic.nextAction).toContain(action);
  },
);

it("keeps a completed agent turn separate from its open business verdict", async () => {
  const fixture = await recoveryFixture();
  const session = fixture.failed.steps.find((step) => step.id === "a")?.session;
  if (!session?.acceptance) throw new Error("Synthetic acceptance is missing");
  const run = patchRecoveryStep(fixture.failed, "a", {
    session: {
      ...session,
      acceptance: { ...session.acceptance, verdict: "open" },
    },
  });
  const result = await readPlanDiagnostic(
    { run: async () => run },
    run.userId,
    {
      planId: run.planId,
      runId: run.id,
      stepId: "a",
    },
  );

  expect(result).toMatchObject({
    diagnostic: {
      status: "succeeded",
      verdict: "open",
      result: { completeness: "unknown" },
    },
  });
  if (!("diagnostic" in result)) throw new Error("Expected diagnostic");
  expect(result.diagnostic.nextAction).toContain("open or rejected checks");
});

it("reads exactly the selected loop iteration and refuses incomplete selectors", async () => {
  const fixture = await recoveryFixture();
  const loop = {
    ...emptyPlanLoop("loop", "Synthetic", { x: 0, y: 0 }),
    steps: [fixture.snapshot.steps[0].step],
  };
  let record = beginIteration(initialLoopRun(loop), loop, new Map());
  record = patchIterationNode(
    record,
    { number: 1, nodeId: "a" },
    {
      status: "failed",
      error: "plan_script_exit",
      script: script(fixture.failed),
    },
  );
  const run = { ...fixture.failed, loops: [record] };
  const plans = { run: async () => run };
  const request = { planId: run.planId, runId: run.id, stepId: "a" };

  await expect(
    readPlanDiagnostic(plans, run.userId, {
      ...request,
      loopId: loop.id,
      iteration: 1,
    }),
  ).resolves.toMatchObject({
    diagnostic: { loopId: loop.id, iteration: 1, exitCode: 7 },
  });
  await expect(
    readPlanDiagnostic(plans, run.userId, {
      ...request,
      loopId: loop.id,
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  await expect(
    readPlanDiagnostic(plans, run.userId, {
      ...request,
      loopId: loop.id,
      iteration: 2,
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("chunks UTF-8 safely and refuses a cursor after the stored attempt changes", async () => {
  const fixture = await recoveryFixture();
  let run = patchRecoveryStep(fixture.failed, "b", {
    script: { ...script(fixture.failed), stdout: "ä😀".repeat(3000) },
  });
  const plans = { run: async () => run };
  const request = {
    planId: run.planId,
    runId: run.id,
    stepId: "b",
    maxBytes: 1024,
  };
  const first = await readPlanDiagnostic(plans, run.userId, request);
  if (!("chunk" in first) || !first.chunk.nextCursor)
    throw new Error("Synthetic diagnostic did not produce chunks");
  let text = first.chunk.text;
  let cursor: string | null = first.chunk.nextCursor;
  while (cursor) {
    const page = await readPlanDiagnostic(plans, run.userId, {
      ...request,
      cursor,
    });
    if (!("chunk" in page)) throw new Error("Expected a diagnostic chunk");
    expect(page.chunk.offsetBytes).toBe(Buffer.byteLength(text));
    text += page.chunk.text;
    cursor = page.chunk.nextCursor;
  }
  expect(createHash("sha256").update(text).digest("hex")).toBe(
    first.chunk.sha256,
  );
  expect(JSON.parse(text)).toMatchObject({
    diagnostic: { stdout: { text: "ä😀".repeat(3000) } },
  });

  run = patchRecoveryStep(run, "b", {
    script: { ...script(run), stdout: "changed" },
  });
  await expect(
    readPlanDiagnostic(plans, run.userId, {
      ...request,
      cursor: first.chunk.nextCursor,
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
});

it("checks the owning run and refuses run-scoped credentials", async () => {
  const fixture = await recoveryFixture();
  const run = fixture.failed;
  const plans = {
    run: async (userId: string) => {
      if (userId !== run.userId) throw new AgentError("plan_access_denied");
      return run;
    },
  };
  const request = { planId: run.planId, runId: run.id, stepId: "b" };
  await expect(
    readPlanDiagnostic(plans, "other", request),
  ).rejects.toMatchObject({
    code: "plan_access_denied",
  });
  await expect(
    readPlanDiagnostic(plans, run.userId, { ...request, planId: "other" }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });

  const world = new PlanWorld();
  const identity = {
    ...world.identity("owner"),
    run: {
      runId: "session-run",
      stepId: "session-step",
      operations: [],
      tickets: [],
      reach: "full" as const,
    },
  };
  await expect(
    world.operations.handle(identity, "plans.run.diagnostics.read", request),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
