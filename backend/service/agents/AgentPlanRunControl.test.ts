import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { readPlanRecoveryCommand } from "@/backend/agents/AgentPlanRecoveryInput";
import { AgentPlanProgressRepository } from "@/backend/database/repositories/agent/AgentPlanProgressRepository";
import { AgentPlanRecoveryRepository } from "@/backend/database/repositories/agent/AgentPlanRecoveryRepository";
import { AgentPlanCheckpointRepository } from "@/backend/database/repositories/agent/AgentPlanCheckpointRepository";
import { readPlanCommand } from "./AgentPlanCommandInput";
import { AgentPlanRecoveryService } from "./recovery/AgentPlanRecoveryService";
import { AgentPlanStartResources } from "./AgentPlanStartResources";
import { restartOption } from "./recovery/AgentPlanRecoveryPlanning";
import { emptyAgentPlan } from "@/definition/AgentPlan";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlanRun, AgentPlanView } from "@/definition/AgentPlan";

function runFixture(): AgentPlanRun {
  return {
    id: randomUUID(),
    planId: randomUUID(),
    planName: "Fixture",
    planRevision: 7,
    userId: "executor",
    startedAt: "2026-01-01T00:00:00.000Z",
    status: "failed",
    stopRequested: false,
    steps: [],
  };
}

function planFixture(run: AgentPlanRun): AgentPlanView {
  return {
    ...emptyAgentPlan(),
    id: run.planId,
    ownerId: run.userId,
    projectId: randomUUID(),
    revision: 7,
    canEdit: true,
    projectName: "Fixture",
    github: null,
  };
}

describe("run command contracts", () => {
  it.each(["plans.play", "plans.pause", "plans.resume", "plans.stop"] as const)(
    "accepts %s without a revision and ignores a legacy client counter",
    (operation) => {
      const input = {
        operationId: "stable-command",
        planId: "plan",
        ...(operation === "plans.play" ? {} : { runId: "run" }),
      };
      const current = readPlanCommand(operation, input);
      expect(
        readPlanCommand(operation, { ...input, expectedRevision: 999 }),
      ).toEqual(current);
    },
  );

  it("still requires the saved plan revision for deletion", () => {
    expect(() =>
      readPlanCommand("plans.delete", {
        operationId: "stable-command",
        planId: "plan",
      }),
    ).toThrow();
    expect(
      readPlanCommand("plans.delete", {
        operationId: "stable-command",
        planId: "plan",
        expectedRevision: 7,
      }).expectedRevision,
    ).toBe(7);
  });

  it.each(["cancel", "release"] as const)(
    "needs only stable identity for recovery %s",
    (action) => {
      const input = { action, idempotencyKey: "stable-command" };
      expect(readPlanRecoveryCommand(input)).toEqual(input);
      expect(
        readPlanRecoveryCommand({ ...input, expectedRevision: 999 }),
      ).toEqual(input);
    },
  );

  it("keeps restart confirmation while ignoring obsolete version preconditions", () => {
    const input = {
      action: "restart",
      idempotencyKey: "stable-command",
      revision: 7,
      confirmRepeat: true,
    };
    expect(readPlanRecoveryCommand(input)).toEqual({
      action: "restart",
      idempotencyKey: "stable-command",
      confirmRepeat: true,
    });
    expect(() =>
      readPlanRecoveryCommand({ ...input, confirmRepeat: false }),
    ).toThrow();
  });
});

describe("read projection and progress", () => {
  it("does not write unchanged progress but still records an explicit command journal", async () => {
    const run = runFixture();
    const execute = vi.fn(async () => {});
    const transaction: DatabaseTransaction = {
      execute,
      query: async () => [
        [
          JSON.stringify(run),
          186,
          JSON.stringify({ plan: { nodes: [] }, steps: [] }),
        ],
      ],
    };
    const database = {
      query: transaction.query,
      transaction: async <Result>(
        work: (connection: DatabaseTransaction) => Promise<Result>,
      ): Promise<Result> => work(transaction),
    };
    const progress = new AgentPlanProgressRepository(database);
    const journal = vi.fn(async () => {});
    for (let read = 0; read < 4; read += 1)
      await progress.update(run, undefined, journal);
    expect(execute).not.toHaveBeenCalled();
    expect(journal).toHaveBeenCalledTimes(4);
  });

  it("reads its recovery audit counter after the authorized progress projection", async () => {
    const run = runFixture();
    let revision = 186;
    const transaction: DatabaseTransaction = {
      execute: async () => {
        throw new Error("Read must not write");
      },
      query: async (statement) =>
        statement.includes("view_json")
          ? [[JSON.stringify(run), revision, JSON.stringify({ steps: [] })]]
          : [],
    };
    const database = {
      query: transaction.query,
      transaction: async <Result>(
        work: (connection: DatabaseTransaction) => Promise<Result>,
      ): Promise<Result> => work(transaction),
    };
    const service = new AgentPlanRecoveryService({
      runs: {
        run: async () => {
          revision += 1;
          return run;
        },
      },
      recovery: new AgentPlanRecoveryRepository(database),
      checkpoints: new AgentPlanCheckpointRepository(database),
    });
    expect((await service.view(run.userId, run.id)).revision).toBe(187);
  });
});

describe("start ownership", () => {
  it("does not turn a new Start into cancellation of any existing resource owner", async () => {
    const conflicts = vi.fn(async () => []);
    const retire = vi.fn(async () => runFixture());
    const service = new AgentPlanStartResources({
      repository: {
        conflicts,
        retire,
        localOwners: async () => [],
        complete: async () => {},
      },
    });
    const run = runFixture();
    const fence = vi.fn(async () => {});
    expect(
      await service.releaseResources(
        { id: randomUUID(), planId: run.planId, userId: run.userId },
        [],
        fence,
      ),
    ).toEqual([]);
    expect(conflicts).not.toHaveBeenCalled();
    expect(retire).not.toHaveBeenCalled();
    expect(fence).not.toHaveBeenCalled();
  });

  it("limits explicit restart cleanup to the named source, even when a newer owner is returned", async () => {
    const source = runFixture();
    const newer = { ...source, id: randomUUID(), status: "running" as const };
    const retire = vi.fn<
      ConstructorParameters<
        typeof AgentPlanStartResources
      >[0]["repository"]["retire"]
    >(async () => source);
    const complete = vi.fn(async () => {});
    const service = new AgentPlanStartResources({
      repository: {
        conflicts: async () => [
          { run: source, resources: [] },
          { run: newer, resources: [] },
        ],
        retire,
        localOwners: async () => [],
        complete,
      },
    });
    await service.releaseResources(
      {
        id: randomUUID(),
        planId: source.planId,
        userId: source.userId,
        sourceRunId: source.id,
      },
      [],
      async (id, record) => {
        expect(id).toBe(source.id);
        await record();
      },
    );
    expect(retire).toHaveBeenCalledTimes(1);
    expect(retire.mock.calls[0]?.[0]).toBe(source.id);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("refuses to restart a superseded source before cleanup can begin", () => {
    const run = runFixture();
    expect(
      restartOption({
        run,
        plan: planFixture(run),
        latest: { ...run, id: randomUUID() },
        isReserved: false,
        checkpoints: [],
        executions: [],
        agentStepIds: [],
        groupIds: [],
      }),
    ).toEqual({ available: false, reason: "superseded" });
  });
});
