import { expect, it, vi } from "vitest";

import {
  appendRunnerSessionEvents,
  persistRunnerSessionEvents,
  runnerSessionState,
} from "@/backend/database/repositories/runner/RunnerSessionEvents";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";

const binding = {
  planId: "plan",
  runId: "run",
  stepId: "step",
  attemptId: "attempt",
  planRevision: 1,
};
const event = {
  sequence: 1,
  kind: "message",
  text: "hello",
  createdAt: "2026-01-01",
  isTruncated: false,
};

it.each([
  ["succeeded", "ended"],
  ["running", "running"],
  ["failed", "failed"],
  ["cancelled", "cancelled"],
] as const)("maps an attested %s session to %s", (status, expected) => {
  expect(runnerSessionState(partial<AgentPlanStepResult>({ status }))).toBe(
    expected,
  );
});

it("accepts a confirmed never-started pause but rejects unattested states", () => {
  expect(
    runnerSessionState(
      partial<AgentPlanStepResult>({
        status: "paused",
        cancellation: "not_started",
        remote: { status: "interrupted", closeout: "confirmed" },
      }),
    ),
  ).toBe("cancelled");
  expect(() =>
    runnerSessionState(partial<AgentPlanStepResult>({ status: "paused" })),
  ).toThrow();
});

it("requires a matching attempt and synchronized event bodies", async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce([])
    .mockResolvedValue([["attempt"]]);
  const execute = vi.fn();
  const transaction = partial<DatabaseTransaction>({ query, execute });
  const input = partial<Parameters<typeof appendRunnerSessionEvents>[1]>({
    binding,
    jobId: "job",
    events: [event],
  });
  await expect(appendRunnerSessionEvents(transaction, input)).rejects.toThrow(
    "binding mismatch",
  );
  await expect(appendRunnerSessionEvents(transaction, input)).rejects.toThrow(
    "synchronized",
  );
  expect(execute).not.toHaveBeenCalled();
});

it("appends only prepared bodies to a bound attempt and advances the sequence", async () => {
  const query = vi.fn(async () => [["attempt"]]);
  const execute = vi.fn();
  const transaction = partial<DatabaseTransaction>({ query, execute });
  await appendRunnerSessionEvents(
    transaction,
    partial<Parameters<typeof appendRunnerSessionEvents>[1]>({
      binding,
      jobId: "job",
      events: [event],
      prepared: { bodies: ["body-file"], events: [], chunks: [] },
    }),
  );
  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute).toHaveBeenNthCalledWith(
    1,
    expect.stringContaining("INSERT INTO agent_session_events"),
    expect.objectContaining({
      attempt_id: "attempt",
      sequence: 1,
      body: "",
      body_file: "body-file",
    }),
  );
  expect(execute).toHaveBeenNthCalledWith(
    2,
    expect.stringContaining("UPDATE agent_session_attempts"),
    { attempt_id: "attempt", next_sequence: 2 },
  );
});

it("ignores events without a compatible recorded remote attempt", async () => {
  const execute = vi.fn();
  const transaction = partial<DatabaseTransaction>({ execute });
  const run = partial<AgentPlanRun>({ steps: [{ id: "step", session: null }] });
  await persistRunnerSessionEvents(transaction, run, {
    stepId: "step",
    events: [],
  });
  expect(execute).not.toHaveBeenCalled();
});
