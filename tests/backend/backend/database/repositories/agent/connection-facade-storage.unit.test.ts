import { describe, expect, it, vi } from "vitest";

import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";

function fixture(): {
  repository: AgentConnectionRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn();
  const execute = vi.fn().mockResolvedValue(undefined);
  const transaction = partial<DatabaseTransaction>({ query, execute });
  const database = partial<Database>({
    query,
    execute,
    transaction: async <Result>(
      work: (activeTransaction: DatabaseTransaction) => Promise<Result>,
    ): Promise<Result> => work(transaction),
  });
  return {
    repository: new AgentConnectionRepository(database),
    query,
    execute,
  };
}

describe("agent connection facade storage", () => {
  it("reads counts, usage and encrypted secrets without exposing absent rows", async () => {
    const { repository, query } = fixture();
    query
      .mockResolvedValueOnce([[2]])
      .mockResolvedValueOnce([["id", "Agent"]])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([["cipher"]]);
    await expect(repository.count()).resolves.toBe(2);
    await expect(repository.usages("c")).resolves.toEqual([
      { kind: "agent", id: "id", name: "Agent" },
    ]);
    await expect(repository.findSecretEncrypted("c")).resolves.toBeNull();
    await expect(repository.findSecretEncrypted("c")).resolves.toBe("cipher");
  });

  it("stores defaults and invalidates checks when credentials or model change", async () => {
    const { repository, execute } = fixture();
    await repository.insert({
      id: "c",
      name: "Connection",
      provider: "openrouter",
      secretEncrypted: null,
      testModel: null,
      actorId: "u",
    });
    const change = {
      name: "Renamed",
      secretEncrypted: null,
      testModel: "m",
      reasoningEffort: null,
      clearModel: true,
      actorId: "u",
    };
    await repository.update("c", change);
    await repository.update("c", { ...change, secretEncrypted: "new" });
    expect(execute).toHaveBeenCalledTimes(8);
  });

  it("assigns a default only once and clears its model check", async () => {
    const { repository, query, execute } = fixture();
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([["c"]]);
    await expect(repository.assignDefaultModel("c", "m")).resolves.toBe(false);
    await expect(repository.assignDefaultModel("c", "m")).resolves.toBe(true);
    expect(execute).toHaveBeenCalledOnce();
    await repository.setCliAccount("c", { loggedInAt: null, label: null }, "u");
    expect(execute).toHaveBeenCalledTimes(3);
  });
});
