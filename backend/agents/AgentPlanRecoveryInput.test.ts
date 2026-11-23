import { describe, expect, it } from "vitest";

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

const DIGEST = "a".repeat(64);
const KEY = "key-12345";

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    return error instanceof AgentPlanRecoveryError ? error.code : "other";
  }
  return undefined;
}

describe("simple readers", () => {
  it("reads the recovery reason and leaves absent metadata absent", () => {
    expect(readPlanRecoveryReason(undefined)).toBeUndefined();
    const reason = {
      state: "recoverable",
      requiresReconciliation: false,
      automaticResume: { state: "pending", reason: "x" },
    };
    expect(readPlanRecoveryReason(reason)).toEqual(reason);
    expect(codeOf(() => readPlanRecoveryReason({ state: "x" }))).toBe(
      "invalid_request",
    );
  });

  it("reads capabilities and digests", () => {
    const capabilities = { canResume: true, canLoad: false, adapter: "a" };
    expect(readPlanContinuationCapabilities(capabilities)).toEqual(
      capabilities,
    );
    expect(codeOf(() => readPlanContinuationCapabilities({}))).toBe(
      "invalid_request",
    );
    expect(readPlanContentDigest(DIGEST)).toBe(DIGEST);
    expect(codeOf(() => readPlanContentDigest("nope"))).toBe("invalid_request");
  });
});

describe("readPlanRecoveryCommand", () => {
  it("strips the obsolete counter and revision", () => {
    expect(
      readPlanRecoveryCommand({
        action: "cancel",
        idempotencyKey: KEY,
        expectedRevision: 3,
      }),
    ).toEqual({ action: "cancel", idempotencyKey: KEY });
    expect(
      readPlanRecoveryCommand({
        action: "resume",
        idempotencyKey: KEY,
        revision: 2,
      }),
    ).toEqual({ action: "resume", idempotencyKey: KEY, reviewedStepIds: [] });
    expect(
      readPlanRecoveryCommand({
        action: "restart",
        idempotencyKey: KEY,
        revision: 2,
        confirmRepeat: true,
      }),
    ).toEqual({
      action: "restart",
      idempotencyKey: KEY,
      confirmRepeat: true,
    });
  });

  it("reads the remaining actions and rejects invalid ones", () => {
    for (const input of [
      {
        action: "record_repair",
        idempotencyKey: KEY,
        stepId: "s",
        instruction: " fix ",
      },
      {
        action: "reconcile",
        idempotencyKey: KEY,
        stepId: "s",
        decision: "effects_reviewed",
        note: "ok",
      },
      { action: "release", idempotencyKey: KEY },
    ])
      expect(readPlanRecoveryCommand(input).action).toBe(input.action);
    expect(codeOf(() => readPlanRecoveryCommand({ action: "cancel" }))).toBe(
      "invalid_request",
    );
  });
});

describe("persisted records", () => {
  it("reads an attempt, result, origin and execution", () => {
    const attempt = {
      id: "a",
      runId: "r",
      userId: "u",
      stepId: null,
      action: "cancel",
      text: null,
      status: "cancelled",
      revision: 1,
      createdAt: "t",
    };
    expect(readPlanRepairAttempt(attempt)).toEqual(attempt);
    expect(codeOf(() => readPlanRepairAttempt({}))).toBe("checkpoint_invalid");
    const result = { commandId: "c", revision: 1, outcome: "reset" };
    expect(readPlanRecoveryResult(result)).toEqual(result);
    expect(codeOf(() => readPlanRecoveryResult({}))).toBe("checkpoint_invalid");
    expect(readPlanRunOrigin(undefined)).toBeUndefined();
    const origin = {
      kind: "resume",
      runId: "r",
      mode: null,
      checkpointVersion: null,
      reusedStepIds: [],
      retriedStepIds: [],
      reviewedStepIds: [],
      requestedAt: "t",
    };
    expect(readPlanRunOrigin(origin)).toEqual(origin);
    expect(codeOf(() => readPlanRunOrigin({}))).toBe("checkpoint_invalid");
    const execution = {
      id: "e",
      runId: "r",
      userId: "u",
      action: "release",
      targetRunId: null,
      origin: null,
      revision: 0,
      createdAt: "t",
    };
    expect(readPlanRecoveryExecution(execution)).toEqual(execution);
    expect(codeOf(() => readPlanRecoveryExecution({}))).toBe(
      "checkpoint_invalid",
    );
  });

  it("reads a checkpoint and rejects a malformed one", () => {
    const checkpoint = {
      schemaVersion: 1,
      runId: "r",
      planId: "p",
      planRevision: 1,
      stepId: "s",
      completedAt: "t",
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
        technical: { resultCode: 0, closeout: null },
        acceptance: null,
      },
      session: null,
      version: 1,
      runRevision: 0,
    };
    const parsed = readPlanCheckpoint(checkpoint);
    expect(parsed.result.isOutputReduced).toBe(false);
    expect(codeOf(() => readPlanCheckpoint({}))).toBe("checkpoint_invalid");
  });
});
