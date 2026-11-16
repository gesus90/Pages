import { describe, expect, it, vi } from "vitest";

import { AgentPlanOneShotService } from "@/backend/service/agents/AgentPlanOneShotService";

vi.mock("@/backend/logging/Logger", () => ({
  logEvent: vi.fn(),
  logCaughtError: vi.fn(),
}));

const candidate = {
  planId: "p",
  name: "Plan",
  ownerId: "u",
  projectId: "project",
  deletionAt: "2026-01-01T00:00:00.000Z",
  isOneShot: true,
  hasActiveRun: false,
  latestRunStatus: "succeeded",
};

function fixture(): {
  service: AgentPlanOneShotService;
  repository: {
    schedule: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    listDue: ReturnType<typeof vi.fn>;
    findCandidate: ReturnType<typeof vi.fn>;
    deletePlan: ReturnType<typeof vi.fn>;
  };
  purgeRuns: ReturnType<typeof vi.fn>;
} {
  const repository = {
    schedule: vi.fn().mockResolvedValue(true),
    cancel: vi.fn().mockResolvedValue(undefined),
    listDue: vi.fn().mockResolvedValue(["p"]),
    findCandidate: vi.fn().mockResolvedValue(candidate),
    deletePlan: vi.fn().mockResolvedValue("deleted"),
  };
  const purgeRuns = vi.fn().mockResolvedValue(true);
  return {
    service: new AgentPlanOneShotService({
      repository,
      purgeRuns,
      now: () => new Date("2026-01-02T00:00:00.000Z"),
    }),
    repository,
    purgeRuns,
  };
}

describe("one-shot plan deletion decisions", () => {
  it("schedules and processes a successful due plan", async () => {
    const { service, repository, purgeRuns } = fixture();
    await expect(service.scheduleAfterSuccess("p")).resolves.toBe(true);
    expect(repository.schedule).toHaveBeenCalledWith(
      "p",
      "2026-01-02T00:05:00.000Z",
    );
    await expect(service.deleteDue()).resolves.toEqual(["p"]);
    expect(purgeRuns).toHaveBeenCalledWith("p");
    expect(repository.deletePlan).toHaveBeenCalledWith("p");
  });

  it("keeps plans that are absent, changed, premature, or active", async () => {
    const { service, repository, purgeRuns } = fixture();
    repository.findCandidate
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...candidate, isOneShot: false })
      .mockResolvedValueOnce({ ...candidate, deletionAt: null })
      .mockResolvedValueOnce({
        ...candidate,
        deletionAt: "2027-01-01T00:00:00.000Z",
      })
      .mockResolvedValueOnce({ ...candidate, hasActiveRun: true })
      .mockResolvedValueOnce({ ...candidate, latestRunStatus: "failed" });
    for (const expected of [
      "not_due",
      "kept",
      "kept",
      "not_due",
      "kept",
      "kept",
    ]) {
      await expect(service.deleteIfDue("p")).resolves.toBe(expected);
    }
    expect(repository.cancel).toHaveBeenCalledTimes(2);
    expect(purgeRuns).not.toHaveBeenCalled();
  });

  it("waits for run cleanup and handles concurrent changes and errors", async () => {
    const { service, repository, purgeRuns } = fixture();
    purgeRuns.mockResolvedValueOnce(false);
    await expect(service.deleteIfDue("p")).resolves.toBe("waiting");
    repository.deletePlan.mockResolvedValueOnce("not_due");
    await expect(service.deleteIfDue("p")).resolves.toBe("kept");
    expect(repository.cancel).toHaveBeenCalledWith("p");
    repository.findCandidate.mockRejectedValueOnce(new Error("storage"));
    await expect(service.deleteIfDue("p")).resolves.toBe("failed");
  });
});
