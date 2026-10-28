import { expect, it } from "vitest";

import {
  readPlanCheckpoint,
  readPlanContentDigest,
  readPlanContinuationCapabilities,
  readPlanRecoveryCommand,
  readPlanRecoveryExecution,
  readPlanRecoveryReason,
  readPlanRecoveryResult,
  readPlanRepairAttempt,
  readPlanRunOrigin,
} from "@/backend/agents/AgentPlanRecoveryInput";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";

import { DIGEST } from "./agent-plan-record-fixture";

const ORIGIN = {
  kind: "resume",
  runId: "old",
  mode: "native_resume",
  checkpointVersion: 2,
  reusedStepIds: ["a"],
  retriedStepIds: [],
  reviewedStepIds: [],
  requestedAt: "now",
};

function recoveryCode(work: () => unknown): string | null {
  try {
    work();
  } catch (error: unknown) {
    return error instanceof AgentPlanRecoveryError ? error.code : "other";
  }
  return null;
}

it("keeps absent legacy metadata absent", () => {
  expect(readPlanRecoveryReason(undefined)).toBeUndefined();
  expect(readPlanRunOrigin(undefined)).toBeUndefined();
});

it("reads a recovery reason and refuses unknown fields", () => {
  expect(
    readPlanRecoveryReason({
      state: "interrupted",
      requiresReconciliation: true,
    }),
  ).toEqual({ state: "interrupted", requiresReconciliation: true });
  expect(
    recoveryCode(() =>
      readPlanRecoveryReason({
        state: "interrupted",
        requiresReconciliation: true,
        extra: 1,
      }),
    ),
  ).toBe("invalid_request");
});

it("reads the origin of a resumed run", () => {
  expect(readPlanRunOrigin(ORIGIN)).toEqual(ORIGIN);
  expect(
    recoveryCode(() => readPlanRunOrigin({ ...ORIGIN, kind: "copy" })),
  ).toBe("checkpoint_invalid");
});

it("reads a journaled recovery execution", () => {
  const execution = {
    id: "e",
    runId: "run",
    userId: "owner",
    action: "resume",
    targetRunId: null,
    origin: ORIGIN,
    revision: 0,
    createdAt: "now",
  };
  expect(readPlanRecoveryExecution(execution)).toEqual(execution);
  expect(
    recoveryCode(() =>
      readPlanRecoveryExecution({ ...execution, revision: -1 }),
    ),
  ).toBe("checkpoint_invalid");
});

it("reads continuation capabilities and a prompt digest", () => {
  expect(
    readPlanContinuationCapabilities({
      canResume: false,
      canLoad: true,
      adapter: "acp",
    }),
  ).toEqual({ canResume: false, canLoad: true, adapter: "acp" });
  expect(readPlanContentDigest(DIGEST)).toBe(DIGEST);
  expect(recoveryCode(() => readPlanContentDigest("ABC"))).toBe(
    "invalid_request",
  );
});

it("reads a checkpoint and defaults the reduced-output flag", () => {
  const checkpoint = {
    schemaVersion: 1,
    runId: "run",
    planId: "plan",
    planRevision: 1,
    stepId: "step",
    completedAt: "now",
    snapshotDigest: DIGEST,
    workflow: { engine: "pages", runId: null },
    completedStepIds: [],
    pendingStepIds: [],
    dependencies: [],
    inputs: [],
    configurationDigest: DIGEST,
    workspaceDigest: DIGEST,
    context: {
      groupId: null,
      agentId: null,
      agentRevision: null,
      connectionId: null,
      provider: null,
      model: null,
      workspaceIds: [],
    },
    dispatchedPromptDigest: null,
    result: {
      output: null,
      outputDigest: DIGEST,
      technical: { resultCode: null, closeout: null },
      acceptance: null,
    },
    session: null,
    version: 1,
    runRevision: 0,
  };
  expect(readPlanCheckpoint(checkpoint).result.isOutputReduced).toBe(false);
  expect(
    recoveryCode(() => readPlanCheckpoint({ ...checkpoint, schemaVersion: 2 })),
  ).toBe("checkpoint_invalid");
});

it("reads versioned recovery commands and refuses unknown actions", () => {
  expect(
    readPlanRecoveryCommand({
      expectedRevision: 1,
      idempotencyKey: "key-12345",
      action: "resume",
      mode: "live",
    }),
  ).toEqual({
    expectedRevision: 1,
    idempotencyKey: "key-12345",
    action: "resume",
    mode: "live",
    reviewedStepIds: [],
  });
  expect(
    recoveryCode(() =>
      readPlanRecoveryCommand({
        expectedRevision: 1,
        idempotencyKey: "key-12345",
        action: "delete",
      }),
    ),
  ).toBe("invalid_request");
});

it("reads repair attempts and replayed results", () => {
  const attempt = {
    id: "a",
    runId: "run",
    userId: "owner",
    stepId: null,
    action: "cancel",
    text: null,
    status: "cancelled",
    revision: 2,
    createdAt: "now",
  };
  expect(readPlanRepairAttempt(attempt)).toEqual(attempt);
  expect(
    recoveryCode(() => readPlanRepairAttempt({ ...attempt, status: "x" })),
  ).toBe("checkpoint_invalid");
  const result = {
    commandId: "c",
    revision: 3,
    outcome: "started",
    runId: "r",
  };
  expect(readPlanRecoveryResult(result)).toEqual(result);
  expect(
    recoveryCode(() => readPlanRecoveryResult({ ...result, outcome: "x" })),
  ).toBe("checkpoint_invalid");
});
