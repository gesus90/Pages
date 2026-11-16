import { describe, expect, it, vi } from "vitest";

import { PlanRunCommandRepository } from "@/backend/database/repositories/agent/PlanRunCommandRepository";

describe("plan run command storage", () => {
  it("creates receipts and reads pending commands with their private references", async () => {
    const query = vi.fn().mockResolvedValue([
      ["id", "run", "pause", "now", null, "accepted"],
      ["id2", "run", "resume", "later", "file", "applied"],
    ]);
    const repository = new PlanRunCommandRepository({
      query,
      execute: vi.fn(),
    });
    expect(repository.receipt("run", "stop")).toMatchObject({
      runId: "run",
      action: "stop",
      status: "accepted",
    });
    await expect(repository.pending()).resolves.toEqual([
      {
        receipt: {
          id: "id",
          runId: "run",
          action: "pause",
          acceptedAt: "now",
          status: "accepted",
        },
        snapshotFile: null,
      },
      {
        receipt: {
          id: "id2",
          runId: "run",
          action: "resume",
          acceptedAt: "later",
          status: "applied",
        },
        snapshotFile: "file",
      },
    ]);
    await expect(repository.snapshot("plan", undefined)).resolves.toBeNull();
    await expect(repository.readSnapshot(null)).resolves.toBeUndefined();
  });

  it("reads acknowledgement states and rejects invalid stored status", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([["id", "pause", "failed", "now", "reason"]])
      .mockResolvedValueOnce([["id", "pause", "accepted", "now", null]])
      .mockResolvedValueOnce([["id", "pause", "unknown", "now", null]])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([["id"]]);
    const repository = new PlanRunCommandRepository({
      query,
      execute: vi.fn(),
    });
    await expect(repository.latest("run")).resolves.toBeNull();
    await expect(repository.latest("run")).resolves.toMatchObject({
      status: "failed",
      error: "reason",
    });
    await expect(repository.latest("run")).resolves.toEqual({
      id: "id",
      runId: "run",
      action: "pause",
      status: "accepted",
      acceptedAt: "now",
    });
    await expect(repository.latest("run")).rejects.toThrow(
      "Invalid run command status",
    );
    await expect(repository.hasAccepted()).resolves.toBe(false);
    await expect(repository.hasAccepted()).resolves.toBe(true);
  });

  it("writes state transitions to the selected transaction", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const repository = new PlanRunCommandRepository({
      query: vi.fn(),
      execute,
    });
    const transaction = {
      query: vi.fn(),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    const receipt = repository.receipt("run", "start");
    await repository.insert(transaction, receipt);
    await repository.applied(transaction, receipt.id);
    await repository.failed(receipt.id, "error", transaction);
    await repository.failed(receipt.id, "error");
    await repository.delivered(receipt.id);
    expect(transaction.execute).toHaveBeenCalledTimes(3);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
