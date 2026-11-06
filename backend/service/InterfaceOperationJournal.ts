import { fingerprintOperation } from "@/backend/service/agents/AgentOperationRecorder";

import type { z } from "zod";
import type { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";

/**
 * How long a save's result answers a repetition.
 *
 * @remarks
 * A browser repeats an unconfirmed save when the connection returns, which may
 * take days. A later repetition falls back to the revision check, which also
 * never applies a save twice but may report a conflict.
 */
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** A save from the interface, identified by the operation ID the browser keeps for it. */
export interface InterfaceOperation {
  readonly userId: string;
  /** The kind of save, such as `ui.wiki.save`. */
  readonly operation: string;
  readonly operationId: string;
  /** Everything the save depends on, in a fixed order of its fields. */
  readonly request: unknown;
}

/** The operation ID was used before for a different save. */
export class OperationReusedError extends Error {
  public constructor() {
    super("The operation ID belongs to another save.");
    this.name = "OperationReusedError";
  }
}

function fingerprintOf(operation: InterfaceOperation): string {
  return fingerprintOperation({
    operation: operation.operation,
    request: operation.request,
  });
}

/**
 * Returns what a save with this operation ID stored when it committed.
 *
 * @param keys - Operation keys, in the transaction of the save if it has one.
 * @param operation - The repeated save.
 * @param schema - The stored result's shape.
 * @returns The stored result, or `null` when the operation never committed.
 * @throws {OperationReusedError} When the ID was stored for another save.
 *
 * @remarks
 * The table is the one of the agent operations (`agent_operation_keys`); the
 * account is part of the key, so another account never finds the result.
 */
export async function replayInterfaceOperation<Result>(
  keys: AgentOperationKeyRepository,
  operation: InterfaceOperation,
  schema: z.ZodType<Result>,
): Promise<Result | null> {
  const previous = await keys.find(operation.userId, operation.operationId);
  if (!previous) return null;
  if (
    previous.operation !== operation.operation ||
    previous.fingerprint !== fingerprintOf(operation)
  )
    throw new OperationReusedError();
  return schema.parse(JSON.parse(previous.resultJson));
}

/**
 * Stores the result of a save under its operation ID.
 *
 * @param keys - Operation keys bound to the transaction of the save.
 * @param operation - The save that is about to commit.
 * @param result - What a repetition of the save answers.
 *
 * @remarks
 * Also removes the account's results of this kind that are past their retention.
 */
export async function recordInterfaceOperation(
  keys: AgentOperationKeyRepository,
  operation: InterfaceOperation,
  result: object,
): Promise<void> {
  await keys.removeOlder(
    operation.userId,
    operation.operation,
    Date.now() - RETENTION_MS,
  );
  await keys.insert(operation.userId, operation.operationId, {
    operation: operation.operation,
    fingerprint: fingerprintOf(operation),
    resultJson: JSON.stringify(result),
  });
}
