import { createHash } from "node:crypto";

import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { StoredAgentOperation } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";

/**
 * Binds an operation ID to the exact request it was first used with.
 *
 * @param request - The request as it was read, in a fixed order of its fields.
 * @returns A fingerprint that differs for any other request.
 */
export function fingerprintOperation(request: unknown): string {
  return createHash("sha256").update(JSON.stringify(request)).digest("hex");
}

/** An earlier call with this operation ID committed first; its result is the answer. */
export class StoredOperationFound extends Error {
  public readonly stored: StoredAgentOperation;

  public constructor(stored: StoredAgentOperation) {
    super("The operation was completed before.");
    this.stored = stored;
  }
}

/**
 * Stores the result of one call under its operation ID, in the commit of the change itself.
 *
 * @remarks
 * Used as the journal of a save: when the same operation ID was committed
 * meanwhile, {@link StoredOperationFound} aborts the save, so a repetition
 * never changes anything twice.
 */
export class OperationRecorder<Result extends object> {
  private readonly userId: string;
  private readonly operation: string;
  private readonly operationId: string;
  private readonly fingerprint: string;
  private readonly results: Result[] = [];

  public constructor(
    userId: string,
    request: {
      readonly operation: string;
      readonly operationId: string;
    },
  ) {
    this.userId = userId;
    this.operation = request.operation;
    this.operationId = request.operationId;
    this.fingerprint = fingerprintOperation(request);
  }

  /** The result of the change that committed. */
  public get result(): Result {
    return this.results[0];
  }

  /**
   * Stores a result, or reports that the operation ID was used before.
   *
   * @param transaction - The transaction of the change.
   * @param result - What a repetition of the call returns.
   * @throws {StoredOperationFound} When the operation ID has a stored result.
   */
  public async store(
    transaction: DatabaseTransaction,
    result: Result,
  ): Promise<void> {
    const keys = new AgentOperationKeyRepository(transaction);
    const previous = await keys.find(this.userId, this.operationId);
    if (previous) throw new StoredOperationFound(previous);
    await keys.insert(this.userId, this.operationId, {
      operation: this.operation,
      fingerprint: this.fingerprint,
      resultJson: JSON.stringify(result),
    });
    this.results.push(result);
  }
}
