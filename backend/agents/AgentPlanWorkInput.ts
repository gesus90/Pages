import { z } from "zod";

import { AgentOperationError } from "@/backend/error/AgentOperationError";

import type {
  AgentPlanCompletionGate,
  AgentPlanWorkRecord,
  AgentPlanWorkView,
} from "@/definition/AgentPlanWork";

const text = z.string().trim().min(1).max(2000);
const scopeItem = z.strictObject({
  itemId: text,
  relevant: z.boolean(),
  reason: z.string().trim().max(2000),
});
const proof = z.strictObject({ itemId: text, evidence: text });
const check = z.strictObject({
  name: text,
  command: text,
  exitCode: z.number().int(),
  evidence: text,
});

/** Schema shared by the editor input parser and execution preflight. */
export const completionGateSchema = z.strictObject({
  version: z.literal(1),
  requiredChecks: z
    .array(text)
    .min(1)
    .max(30)
    .refine((names) => new Set(names).size === names.length),
});

const recordSchema = z.strictObject({
  revision: z.number().int().positive(),
  requirementsHash: text,
  contentHash: text,
  scopeHash: text,
  scope: z.array(scopeItem).max(1000),
  note: text,
  proofs: z.array(proof).max(1000),
  checks: z.array(check).max(30),
  confirmed: z.boolean(),
});

const viewSchema = z.object({
  runId: text,
  stepId: text,
  attemptId: text,
  ticketId: text,
  ticketKey: text,
  statusKey: text,
  requirementsHash: text,
  contentHash: text,
  requiredChecks: z.array(text),
  items: z.array(
    z.object({
      id: text,
      text: z.string(),
      checked: z.boolean(),
      source: z.enum(["description", "criteria"]),
      order: z.number(),
      depth: z.number(),
      parentId: z.string().nullable(),
    }),
  ),
  record: recordSchema.nullable(),
  issues: z.array(text),
});

/** Restores scope and evidence in polling responses without trusting arbitrary stored objects. */
export function readPlanWorkView(input: unknown): AgentPlanWorkView {
  return viewSchema.parse(input);
}

/** Validates the explicit version instead of silently discarding unknown gate settings. */
export function readCompletionGate(
  input: unknown,
): AgentPlanCompletionGate | undefined {
  if (input === undefined) return undefined;
  const parsed = completionGateSchema.safeParse(input);
  if (!parsed.success) throw new AgentOperationError("INVALID_REQUEST");
  return parsed.data;
}

/** Reads a stored immutable work revision with the same constraints as new input. */
export function readPlanWorkRecord(input: unknown): AgentPlanWorkRecord {
  return recordSchema.parse(input);
}

/** Bounded scope/confirmation input; every write names its last observed revision and ticket hashes. */
export const planWorkWriteSchema = z.strictObject({
  ticketId: text,
  expectedRevision: z.number().int().nonnegative(),
  requirementsHash: text,
  contentHash: text,
  action: z.enum(["scope", "confirm"]),
  scope: z.array(scopeItem).max(1000),
  note: text,
  proofs: z.array(proof).max(1000),
  checks: z.array(check).max(30),
});
