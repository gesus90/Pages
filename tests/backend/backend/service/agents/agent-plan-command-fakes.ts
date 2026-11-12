import { vi } from "vitest";

export const TRANSACTION = { marker: "transaction" };

interface StoredOperation {
  fingerprint: string;
  operation: string;
  resultJson: string;
}

/** The state behind the mocked modules; `vi.mock` factories read it through a dynamic import. */
export const world = {
  keys: new Map<string, StoredOperation>(),
  findOverride: null as null | ((operationId: string) => unknown),
  templateWrite: vi.fn(),
  requireRevision: vi.fn(),
  readControl: vi.fn(),
};

/** Stands in for the key repository: the stored operations live in the map of the world. */
export class FakeOperationKeyRepository {
  /** Looks up the stored result of an operation ID. */
  public async find(userId: string, operationId: string): Promise<unknown> {
    return world.findOverride
      ? world.findOverride(operationId)
      : (world.keys.get(operationId) ?? null);
  }

  /** Stores the result under its operation ID. */
  public async insert(
    userId: string,
    operationId: string,
    value: StoredOperation,
  ): Promise<void> {
    world.keys.set(operationId, value);
  }
}

/** Stands in for the template commands, which have their own tests. */
export class FakeTemplateCommands {
  public write = world.templateWrite;
}
