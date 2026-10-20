import { z } from "zod";

import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";
import { planScriptRunSchema } from "./AgentPlanScriptRunInput";

import type {
  AgentPlanCheckpoint,
  AgentPlanContinuationCapabilities,
  AgentPlanRecoveryCommand,
  AgentPlanRecoveryReason,
  AgentPlanRecoveryResult,
  AgentPlanRecoveryErrorCode,
  AgentPlanRecoveryExecution,
  AgentPlanRepairAttempt,
  AgentPlanRunOrigin,
} from "@/definition/AgentPlanRecovery";

const identifier = z.string().min(1).max(200);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const capabilities = z.strictObject({
  canResume: z.boolean(),
  canLoad: z.boolean(),
  adapter: z.string().max(200),
});
const recoveryReason = z.strictObject({
  state: z.enum(["recoverable", "interrupted"]),
  requiresReconciliation: z.boolean(),
});
const acceptance = z.strictObject({
  verdict: z.enum(["accepted", "open", "rejected"]),
  todos: z
    .array(
      z.strictObject({
        id: identifier,
        status: z.enum(["done", "open", "missing"]),
      }),
    )
    .max(200),
  criteria: z
    .array(
      z.strictObject({
        id: identifier,
        met: z.boolean(),
        evidence: z.string().max(2_000),
        ticketChecked: z.boolean().nullable(),
      }),
    )
    .max(200),
  decisions: z.array(z.string().max(2_000)).max(20),
  issues: z.array(z.string().max(500)).max(1_000),
  summary: z.string().max(2_000),
});
const checkpoint = z.strictObject({
  schemaVersion: z.literal(1),
  runId: identifier,
  planId: identifier,
  planRevision: z.number().int().positive(),
  stepId: identifier,
  completedAt: z.string().max(64),
  snapshotDigest: digest,
  workflow: z.strictObject({ engine: z.literal("pages"), runId: z.null() }),
  completedStepIds: z.array(identifier).max(100),
  pendingStepIds: z.array(identifier).max(100),
  dependencies: z
    .array(z.strictObject({ stepId: identifier, status: identifier }))
    .max(100),
  inputs: z
    .array(
      z.strictObject({
        name: identifier,
        kind: z.enum(["literal", "source", "result"]),
        reference: identifier.nullable(),
        digest,
      }),
    )
    .max(200),
  configurationDigest: digest,
  workspaceDigest: digest,
  context: z.strictObject({
    groupId: identifier.nullable(),
    agentId: identifier.nullable(),
    agentRevision: z.number().int().positive().nullable(),
    connectionId: identifier.nullable(),
    provider: identifier.nullable(),
    model: identifier.nullable(),
    workspaceIds: z.array(identifier).max(100),
  }),
  dispatchedPromptDigest: digest.nullable(),
  result: z.strictObject({
    script: planScriptRunSchema.optional(),
    output: z.string().max(200_000).nullable(),
    isOutputReduced: z.boolean().default(false),
    outputDigest: digest,
    technical: z.strictObject({
      resultCode: z.union([z.literal(0), z.literal(-1), z.null()]),
      closeout: identifier.nullable(),
    }),
    acceptance: acceptance.nullable(),
  }),
  session: z
    .strictObject({
      attemptId: identifier.nullable(),
      instanceId: identifier,
      sessionId: identifier.nullable(),
      capabilities: capabilities.nullable(),
    })
    .nullable(),
  version: z.number().int().positive(),
  runRevision: revision,
});
const commandIdentity = {
  expectedRevision: revision,
  idempotencyKey: z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/u),
};
const command = z.discriminatedUnion("action", [
  z.strictObject({
    ...commandIdentity,
    action: z.literal("record_repair"),
    stepId: identifier,
    instruction: z.string().trim().min(1).max(20_000),
  }),
  z.strictObject({
    ...commandIdentity,
    action: z.literal("reconcile"),
    stepId: identifier,
    decision: z.literal("effects_reviewed"),
    note: z.string().trim().min(1).max(20_000),
  }),
  z.strictObject({ ...commandIdentity, action: z.literal("cancel") }),
  z.strictObject({
    ...commandIdentity,
    action: z.literal("resume"),
    mode: z.enum(["live", "native_resume", "new_session"]),
    reviewedStepIds: z.array(identifier).max(100).default([]),
  }),
  z.strictObject({
    ...commandIdentity,
    action: z.literal("restart"),
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    confirmRepeat: z.literal(true),
  }),
  z.strictObject({ ...commandIdentity, action: z.literal("release") }),
]);
const origin = z.strictObject({
  kind: z.enum(["restart", "resume"]),
  runId: identifier,
  mode: z.enum(["native_resume", "new_session"]).nullable(),
  checkpointVersion: z.number().int().positive().nullable(),
  reusedStepIds: z.array(identifier).max(100),
  retriedStepIds: z.array(identifier).max(100),
  reviewedStepIds: z.array(identifier).max(100),
  requestedAt: z.string().max(64),
});
const execution = z.strictObject({
  id: identifier,
  runId: identifier,
  userId: identifier,
  action: z.enum(["restart", "resume", "release"]),
  targetRunId: identifier.nullable(),
  origin: origin.nullable(),
  revision,
  createdAt: z.string().max(64),
});
const attempt = z.strictObject({
  id: identifier,
  runId: identifier,
  userId: identifier,
  stepId: identifier.nullable(),
  action: z.enum(["record_repair", "reconcile", "cancel"]),
  text: z.string().max(20_000).nullable(),
  status: z.enum(["recorded", "cancelled"]),
  revision,
  createdAt: z.string().max(64),
});
const result = z.strictObject({
  commandId: identifier,
  revision,
  outcome: z.enum(["recorded", "cancelled", "started", "released"]),
  runId: identifier.optional(),
});

function parseRecovery<T>(
  schema: z.ZodType<T>,
  input: unknown,
  code: AgentPlanRecoveryErrorCode = "invalid_request",
): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new AgentPlanRecoveryError(code);
  return parsed.data;
}

/** Reads only the additive reason; absent legacy metadata stays absent. */
export function readPlanRecoveryReason(
  input: unknown,
): AgentPlanRecoveryReason | undefined {
  return input === undefined ? undefined : parseRecovery(recoveryReason, input);
}

/** Validates capabilities without inferring them from an adapter name. */
export function readPlanContinuationCapabilities(
  input: unknown,
): AgentPlanContinuationCapabilities {
  return parseRecovery(capabilities, input);
}

/** Rejects a malformed stored prompt digest instead of treating it as context evidence. */
export function readPlanContentDigest(input: unknown): string {
  return parseRecovery(digest, input);
}

/** Validates a versioned checkpoint at its persistence boundary. */
export function readPlanCheckpoint(input: unknown): AgentPlanCheckpoint {
  return parseRecovery(checkpoint, input, "checkpoint_invalid");
}

/** Refuses unversioned control requests and unknown fields before any mutation. */
export function readPlanRecoveryCommand(
  input: unknown,
): AgentPlanRecoveryCommand {
  return parseRecovery(command, input);
}

/** Narrows an append-only repair/audit record. */
export function readPlanRepairAttempt(input: unknown): AgentPlanRepairAttempt {
  return parseRecovery(attempt, input, "checkpoint_invalid");
}

/** Reads the exact result returned for an idempotent command replay. */
export function readPlanRecoveryResult(
  input: unknown,
): AgentPlanRecoveryResult {
  return parseRecovery(result, input, "checkpoint_invalid");
}

/** Reads the origin of a restarted or resumed run; absent for every other run. */
export function readPlanRunOrigin(
  input: unknown,
): AgentPlanRunOrigin | undefined {
  return input === undefined
    ? undefined
    : parseRecovery(origin, input, "checkpoint_invalid");
}

/** Narrows one journaled restart, resume or release. */
export function readPlanRecoveryExecution(
  input: unknown,
): AgentPlanRecoveryExecution {
  return parseRecovery(execution, input, "checkpoint_invalid");
}
