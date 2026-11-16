import { describe, expect, it, vi } from "vitest";

import { AgentRunFailureRepository } from "@/backend/database/repositories/diagnosis/AgentRunFailureRepository";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { RunSearchFilters } from "@/backend/database/repositories/diagnosis/AgentRunFailureRepository";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

const filters: RunSearchFilters = {
  planIds: ["p"],
  projectId: "project",
  planId: "p",
  status: "failed",
  stepId: "step",
  errorClass: "timeout",
  startedById: "u",
  from: "a",
  to: "z",
};

function fixture(): {
  repository: AgentRunFailureRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn();
  const execute = vi.fn().mockResolvedValue(undefined);
  const transaction = partial<DatabaseTransaction>({ execute });
  return {
    repository: new AgentRunFailureRepository({
      query,
      transaction: async (work) => work(transaction),
    }),
    query,
    execute,
  };
}

describe("run failure search storage", () => {
  it("returns pending and damaged runs safely", async () => {
    const { repository, query } = fixture();
    query
      .mockResolvedValueOnce([["r"]])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([["invalid json", 3, "p", "project", "u"]]);
    await expect(repository.pending("start", 10)).resolves.toEqual(["r"]);
    await expect(repository.load("r")).resolves.toBeNull();
    await expect(repository.load("r")).resolves.toMatchObject({
      run: null,
      revision: 3,
      planId: "p",
    });
  });

  it("binds filters and maps search and grouping results", async () => {
    const { repository, query } = fixture();
    query
      .mockResolvedValueOnce([[2]])
      .mockResolvedValueOnce([
        [
          "r",
          "p",
          "Plan",
          "project",
          "failed",
          "start",
          null,
          "u",
          "step",
          "timeout",
          "error",
        ],
      ])
      .mockResolvedValueOnce([
        [
          "unknown-class",
          "p",
          "Plan",
          "step",
          "Step",
          2,
          "first",
          "last",
          "r,r,s",
        ],
      ])
      .mockResolvedValueOnce([]);
    await expect(repository.count(filters)).resolves.toBe(2);
    await expect(
      repository.search(filters, { offset: 0, limit: 5 }),
    ).resolves.toMatchObject([{ runId: "r", errorClass: "timeout" }]);
    await expect(repository.groups(filters, "step", 5)).resolves.toMatchObject([
      { errorClass: null, count: 2, exampleRunIds: ["r", "s"] },
    ]);
    await expect(
      repository.totalFailedSteps({
        ...filters,
        planIds: [],
        projectId: null,
        planId: null,
        status: null,
        stepId: null,
        errorClass: null,
        startedById: null,
        from: null,
        to: null,
      }),
    ).resolves.toBe(0);
  });

  it("replaces indexed failures atomically and prunes old entries", async () => {
    const { repository, execute } = fixture();
    await repository.replace({
      runId: "r",
      revision: 1,
      planId: "p",
      planName: "Plan",
      projectId: "project",
      startedById: "u",
      endedAt: null,
      failedStepId: "step",
      errorClass: "timeout",
      errorCode: "error",
      failures: [
        {
          stepId: "step",
          stepLabel: "Step",
          loopId: null,
          iteration: null,
          attemptId: null,
          errorClass: "timeout",
          errorCode: "error",
          occurredAt: "now",
        },
      ],
    });
    await repository.prune("cutoff");
    expect(execute).toHaveBeenCalledTimes(5);
  });
});
